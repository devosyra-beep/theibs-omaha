"""Independent QA-only sequence-form oracle. No THEIBS solver code is imported.

Method: Koller, Megiddo & von Stengel (1996), section 2, and the zero-sum
sequence-form primal/dual LP. See README.md for conditioning and tolerances.
Input is one JSON object on stdin; output is one JSON object on stdout.
"""
from __future__ import annotations

import copy
import ctypes
import json
import math
import sys
import time
import tracemalloc
from collections import defaultdict

import numpy as np
import scipy
from scipy.optimize import linprog
from scipy.sparse import bmat, coo_matrix, csr_matrix

VERSION = "THEIBS_QA_SEQUENCE_FORM_HIGHS_V1"
TARGET = "PRIVATE_INFORMATION_SET_COMMITMENT_VALUE"


def peak_process_memory():
    """Read the OS peak for this isolated process, including native allocations."""
    try:
        if sys.platform == "win32":
            from ctypes import wintypes
            class Counters(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in
                    ("peakWorkingSet", "workingSet", "peakPagedPool", "pagedPool", "peakNonPagedPool", "nonPagedPool", "pagefile", "peakPagefile")]
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.GetCurrentProcess.restype = wintypes.HANDLE
            psapi = ctypes.WinDLL("psapi", use_last_error=True)
            psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
            psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
            counters = Counters(); counters.cb = ctypes.sizeof(counters)
            if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
                return {"bytes": counters.peakWorkingSet, "method": "WINDOWS_PEAK_WORKING_SET_PROCESS_LIFETIME"}
        else:
            import resource
            peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            return {"bytes": peak * (1 if sys.platform == "darwin" else 1024), "method": "GETRUSAGE_MAXRSS_PROCESS_LIFETIME"}
    except (ImportError, AttributeError, OSError):
        pass
    return {"bytes": None, "method": "UNAVAILABLE"}


def conditioned(game, request):
    result = copy.deepcopy(game)
    count = 0

    def walk(node):
        nonlocal count
        if node["type"] == "decision":
            if node["player"] == request["player"] and node["informationSet"] == request["informationSet"]:
                selected = [edge for edge in node["actions"] if edge["id"] == request["actionId"]]
                if len(selected) != 1:
                    raise ValueError("The conditioned action is absent from its information set.")
                node["actions"] = selected
                count += 1
            for edge in node["actions"]:
                walk(edge["node"])
        elif node["type"] == "chance":
            for edge in node["outcomes"]:
                walk(edge["node"])

    walk(result["root"])
    if not count:
        raise ValueError("The conditioned information set is absent.")
    return result, count


def compile_sequence_form(game):
    if game.get("playerCount") != 2:
        raise ValueError("This reference accepts exactly two players.")
    infos = [[], []]
    lookup = [{}, {}]
    sequences = [[{"empty": True}], [{"empty": True}]]
    payoff_entries = defaultdict(float)
    leaves = []
    constant = None
    nodes = 0

    def visit(node, own_sequences, chance, history):
        nonlocal constant, nodes
        nodes += 1
        if nodes > 100000:
            raise ValueError("QA reference node limit exceeded.")
        kind = node.get("type")
        if kind == "terminal":
            payoffs = node.get("payoffs")
            if not isinstance(payoffs, list) or len(payoffs) != 2 or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in payoffs):
                raise ValueError("Invalid terminal utility.")
            total = sum(payoffs)
            if constant is None:
                constant = total
            if abs(total - constant) > 1e-10 * max(1, abs(total), abs(constant)):
                raise ValueError("A zero-sum/constant-sum reference is required.")
            payoff_entries[tuple(own_sequences)] += chance * payoffs[0]
            leaves.append((chance, list(own_sequences), list(payoffs)))
        elif kind == "chance":
            outcomes = node.get("outcomes", [])
            weights = [edge.get("probability") for edge in outcomes]
            if not weights or not all(isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 1 for value in weights) or abs(sum(weights) - 1) > 1e-12:
                raise ValueError("Chance probabilities must sum to one.")
            normalization = sum(weights)
            for edge in outcomes:
                visit(edge["node"], own_sequences, chance * edge["probability"] / normalization, history)
        elif kind == "decision":
            player, name = node["player"], node["informationSet"]
            if player not in (0, 1) or not isinstance(name, str) or not name:
                raise ValueError("Invalid player or information set.")
            actions = [edge["id"] for edge in node["actions"]]
            if not actions or len(set(actions)) != len(actions):
                raise ValueError("Invalid action support.")
            item = lookup[player].get(name)
            remembered = tuple(history[player])
            if item is None:
                children = []
                for action in actions:
                    children.append(len(sequences[player]))
                    sequences[player].append({"informationSet": name, "action": action})
                item = {"name": name, "parent": own_sequences[player], "actions": actions, "sequences": children, "recall": remembered}
                infos[player].append(item)
                lookup[player][name] = item
            elif item["parent"] != own_sequences[player] or item["recall"] != remembered or item["actions"] != actions:
                raise ValueError("Imperfect recall or inconsistent action support.")
            for edge, sequence in zip(node["actions"], item["sequences"]):
                following = own_sequences.copy()
                following[player] = sequence
                next_history = [list(history[0]), list(history[1])]
                next_history[player].append((name, edge["id"]))
                visit(edge["node"], following, chance, next_history)
        else:
            raise ValueError("Unknown game node type.")

    visit(game["root"], [0, 0], 1.0, [[], []])
    constraints, rhs = [], []
    for player in (0, 1):
        row, col, data = [0], [0], [1.0]
        for index, info in enumerate(infos[player], start=1):
            row.append(index); col.append(info["parent"]); data.append(-1.0)
            for sequence in info["sequences"]:
                row.append(index); col.append(sequence); data.append(1.0)
        matrix = coo_matrix((data, (row, col)), shape=(len(infos[player]) + 1, len(sequences[player]))).tocsr()
        constraints.append(matrix)
        target = np.zeros(matrix.shape[0]); target[0] = 1.0; rhs.append(target)
    pairs = list(payoff_entries)
    payoff = coo_matrix(([payoff_entries[key] for key in pairs], ([key[0] for key in pairs], [key[1] for key in pairs])),
                        shape=(len(sequences[0]), len(sequences[1]))).tocsr()
    return {"infos": infos, "sequences": sequences, "constraints": constraints, "rhs": rhs,
            "payoff": payoff, "constant": constant, "nodes": nodes, "leaves": len(leaves)}


def program(c, **kwargs):
    result = linprog(c, method="highs-ds", options={"primal_feasibility_tolerance": 1e-9,
                     "dual_feasibility_tolerance": 1e-9, "time_limit": 30.0}, **kwargs)
    if not result.success:
        raise ValueError("Reference LP failed: " + result.message)
    return result


def behavior(compiled, player, plan):
    result = {}
    for info in compiled["infos"][player]:
        parent = float(plan[info["parent"]])
        probabilities = [max(0.0, float(plan[index])) / parent for index in info["sequences"]] if parent > 1e-12 else [1.0 / len(info["actions"])] * len(info["actions"])
        total = sum(probabilities)
        result[info["name"]] = dict(zip(info["actions"], [value / total for value in probabilities]))
    return result


def realization(compiled, strategy, player):
    plan = np.zeros(len(compiled["sequences"][player])); plan[0] = 1.0
    for info in compiled["infos"][player]:
        choices = strategy[player].get(info["name"])
        if not isinstance(choices, dict) or set(choices) != set(info["actions"]):
            raise ValueError("Supplied behavior strategy has incompatible action support.")
        probabilities = [choices[action] for action in info["actions"]]
        if not all(isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 1 for value in probabilities) or abs(sum(probabilities) - 1) > 1e-8:
            raise ValueError("Invalid behavior probabilities.")
        for index, probability in zip(info["sequences"], probabilities):
            plan[index] = plan[info["parent"]] * probability / sum(probabilities)
    return plan


def profile_bounds(compiled, x, y):
    a = compiled["payoff"]; e, f = compiled["constraints"]; er, fr = compiled["rhs"]
    upper = program(-np.asarray(a @ y).ravel(), A_eq=e, b_eq=er, bounds=(0, None))
    lower = program(np.asarray(a.T @ x).ravel(), A_eq=f, b_eq=fr, bounds=(0, None))
    lo, hi = float(lower.fun), float(-upper.fun)
    value = float(x @ (a @ y)); constant = compiled["constant"]
    return {"values": [value, constant - value], "lower": [lo, constant - hi], "upper": [hi, constant - lo],
            "nashConv": max(0.0, hi - lo), "unilateralGains": [max(0.0, hi - value), max(0.0, value - lo)],
            "bestResponseValues": [hi, constant - lo]}


def conditional_value(game, strategy, target):
    def walk(node, reached=False):
        if node["type"] == "terminal":
            return (node["payoffs"][target["player"]], 1.0) if reached else (0.0, 0.0)
        if node["type"] == "chance":
            total = sum(edge["probability"] for edge in node["outcomes"])
            entries = [(edge["probability"] / total, edge["node"]) for edge in node["outcomes"]]
        else:
            reached = reached or node["player"] == target["player"] and node["informationSet"] == target["informationSet"]
            total = sum(strategy[node["player"]][node["informationSet"]][edge["id"]] for edge in node["actions"])
            entries = [(strategy[node["player"]][node["informationSet"]][edge["id"]] / total, edge["node"]) for edge in node["actions"]]
        value, mass = 0.0, 0.0
        for weight, child in entries:
            child_value, child_mass = walk(child, reached)
            value += weight * child_value; mass += weight * child_mass
        return value, mass
    value, mass = walk(game["root"])
    return {"value": value / mass if mass > 0 else None, "reach": mass, "target": "CONDITIONAL_CURRENT_PROFILE_NOT_EQUILIBRIUM_CERTIFICATE"}


def solve(request):
    started = time.perf_counter()
    game = request["game"]
    conditioned_nodes = 0
    if request.get("condition"):
        game, conditioned_nodes = conditioned(game, request["condition"])
    compiled = compile_sequence_form(game)
    compiled_at = time.perf_counter()
    a = compiled["payoff"]; e, f = compiled["constraints"]; er, fr = compiled["rhs"]
    nx, ny = a.shape; m0, m1 = e.shape[0], f.shape[0]
    # max f'q: Ex=e, x>=0, F'q <= A'x. Dual variables q are free.
    row = program(np.r_[np.zeros(nx), -fr], A_ub=bmat([[-a.T, f.T]], format="csr"), b_ub=np.zeros(ny),
                  A_eq=bmat([[e, csr_matrix((m0, m1))]], format="csr"), b_eq=er,
                  bounds=[(0, None)] * nx + [(None, None)] * m1)
    # min e'p: Fy=f, y>=0, E'p >= Ay. Dual variables p are free.
    column = program(np.r_[np.zeros(ny), er], A_ub=bmat([[a, -e.T]], format="csr"), b_ub=np.zeros(nx),
                     A_eq=bmat([[f, csr_matrix((m1, m0))]], format="csr"), b_eq=fr,
                     bounds=[(0, None)] * ny + [(None, None)] * m0)
    x, q = row.x[:nx], row.x[nx:]; y, p = column.x[:ny], column.x[ny:]
    scale = max(1.0, abs(compiled["constant"]), float(np.max(np.abs(a.data))) if a.nnz else 0)
    validation_tolerance = 1e-8 * scale
    residuals = {"rowFlow": float(np.max(np.abs(e @ x - er))), "columnFlow": float(np.max(np.abs(f @ y - fr))),
                 "nonnegative": max(0.0, float(-min(np.min(x), np.min(y)))),
                 "rowDualViolation": max(0.0, float(np.max(f.T @ q - a.T @ x))),
                 "columnDualViolation": max(0.0, float(np.max(a @ y - e.T @ p))),
                 "dualityGap": abs(float(column.fun + row.fun))}
    if max(residuals.values()) > validation_tolerance:
        raise ValueError("Reference LP residual guard failed: " + json.dumps(residuals))
    reference = profile_bounds(compiled, x, y)
    if reference["nashConv"] > 2 * validation_tolerance:
        raise ValueError("Reference LP strategy failed independent best-response LP verification.")
    strategies = [behavior(compiled, 0, x), behavior(compiled, 1, y)]
    result = {"version": VERSION, "status": "NUMERICALLY_VALIDATED_LP_REFERENCE", "method": "SPARSE_SEQUENCE_FORM_PRIMAL_DUAL_HIGHS_DUAL_SIMPLEX",
              "target": TARGET if request.get("condition") else "FULL_DECLARED_GAME_MINIMAX_VALUE", "values": reference["values"],
              "strategy": strategies, "reference": reference, "residuals": residuals,
              "validationTolerance": validation_tolerance, "symbolicallyExact": False,
              "constantSum": compiled["constant"], "conditionedNodes": conditioned_nodes,
              "metrics": {"nodes": compiled["nodes"], "leaves": compiled["leaves"], "sequences": [nx, ny], "constraints": [m0, m1],
                          "payoffNonzeros": a.nnz, "estimatedSparseBytes": sum(matrix.data.nbytes + matrix.indices.nbytes + matrix.indptr.nbytes for matrix in (a, e, f)),
                          "compileMs": 1000 * (compiled_at - started), "totalMs": 1000 * (time.perf_counter() - started),
                          "lpIterations": [row.nit, column.nit]},
              "runtime": {"python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__}}
    if request.get("strategy"):
        profile = request["strategy"]
        result["profile"] = profile_bounds(compiled, realization(compiled, profile, 0), realization(compiled, profile, 1))
    else:
        profile = strategies
    if request.get("conditionalInformationSet"):
        result["conditionalCurrentProfile"] = conditional_value(game, profile, request["conditionalInformationSet"])
    return result


if __name__ == "__main__":
    try:
        tracemalloc.start()
        result = solve(json.load(sys.stdin))
        result["metrics"]["pythonTracedPeakBytes"] = tracemalloc.get_traced_memory()[1]
        result["metrics"]["peakProcessMemory"] = peak_process_memory()
        result["metrics"]["memoryNote"] = "Python tracemalloc excludes native HiGHS/BLAS allocations; sparse-byte estimate is not process RSS."
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except Exception as error:
        print(json.dumps({"status": "REFERENCE_ERROR", "error": str(error)}))
        sys.exit(1)
