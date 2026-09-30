# Independent sequence-form reference

This is a **QA dependency only**. THEIBS does not install, import or call Python,
SciPy or HiGHS while serving the application. The checked-in Python compiler and
LP formulation do not import CFR, the production best-response traversal, or
the production action-conditioning implementation.

## Reproduce

Create a separate Python environment, then install `requirements.txt` there:

```powershell
python -m venv "$env:TEMP\theibs-reference-venv"
$env:THEIBS_REFERENCE_PYTHON = "$env:TEMP\theibs-reference-venv\Scripts\python.exe"
& $env:THEIBS_REFERENCE_PYTHON -m pip install -r scripts/reference/requirements.txt
node --test test/solver-sequence-form-reference.test.cjs
node scripts/benchmark-solver-reference.cjs
```

On POSIX, use the environment's `bin/python` instead. The normal Node test suite
reports an explicit skip when the reference dependency is unavailable. The
benchmark requires it and fails if absent. Keep this environment outside release
artifacts. The tested versions are pinned in the requirements file.

The benchmark writes `../../validacao/solver-sequence-form-reference.json` relative
to this source checkout. Evidence is **MODEL**, with actual local numerical
solvers. It does not establish hosted latency or real microphone accuracy.

## Independent formulation

For each player, the compiler creates one empty sequence and one sequence per
information-set action. Realization plans satisfy `Ex=e` and `Fy=f`, with
nonnegative entries. Each information set conserves its own realization mass;
all nodes sharing an information set must share the same recalled own history.
The sparse payoff matrix sums chance-weighted terminal utility by the pair of
terminal sequences. Chance and supplied behavior weights are normalized.

Player 0 maximizes `xᵀAy`. In a two-player constant-sum game, the reference solves
both the maximin LP and its minimax dual using HiGHS dual simplex. It separately
solves two best-response LPs for the returned policies. Primal flow residuals,
nonnegativity, dual feasibility, primal/dual objective agreement and the returned
policy's best-response gap must all pass a scale-aware numerical tolerance.

The mathematical construction follows
[Koller, Megiddo and von Stengel (1996), Section 2](https://ai.stanford.edu/~koller/Papers/Koller%2Bal:GEB96.pdf).
The zero-sum LP presentation is also covered by
[von Stengel's sequence-form lecture](https://conferences.mpi-inf.mpg.de/adfocs-24/material/Bernhard/2ext-adfocs.pdf).

This is a floating-point LP oracle with residual guards, **not a symbolic exact
proof**. Returned `validationTolerance` explicitly governs the independent
comparison. Production outward-rounded certificates are compared with this
separate numeric solution; the reference does not claim that a HiGHS success
flag alone certifies a result.

## Meaning of conditioned action values

Only the requested action at the requested Hero information set is fixed. Every
chance world, prior weight and other information set remains in the game. The
result is `PRIVATE_INFORMATION_SET_COMMITMENT_VALUE`: the **ex ante minimax value
over the full prior** of that restricted game.

It is not the EV of the current private hand under the original game's returned
profile. Conditioning chance on the actual Hero hand would change what the
opponent effectively knows and is deliberately excluded. Other Hero combinations
can still choose their own actions. Accordingly, even a fold commitment can have
a nonzero range-level value from those other combinations.

An adversarial test demonstrates two equilibria with zero global NashConv and the
same global value, yet current-hand conditional values of `-1` and `+1`. This
prevents a global convergence number or a restricted-game value from being
mistaken for a unique conditional equilibrium action EV.

## Included checks

- Unique mixed equilibrium, nonunique equilibria, known Kuhn value and both
  orientations of constant-sum best-response saddle intervals.
- Independent action restrictions, prior preservation and current-hand versus
  full-prior target separation.
- PLO5 exact two-hole/three-board enumeration with an independent five-card
  ranker, joint blockers, normalized joint chance weights, incremental utility
  and declared terminal fees.
- Every root action of a real four-world PLO5 river tree, across refinement
  budgets, compared with its separate LP solution and independent LP best responses.
- A candidate is called dominant only when its lower bound exceeds the upper
  bound of **every** other comparable action. Alternative optimal strategies are
  allowed; equality to one selected LP strategy is not required.

The reference is limited to the exact supplied finite two-player constant-sum
game. It does not cover omitted sizes, broader ranges, full-hand safety constraints,
multiway general-sum equilibrium, or the quality of manually selected priors.

Timing includes both internal LP time and subprocess wall time. The report
records OS process-lifetime peak memory for the isolated reference process,
including its interpreter and native HiGHS/BLAS allocations. It also reports
Python traced memory (which excludes those native allocations), sparse-storage
estimates and Node process RSS samples. These are explicitly different metrics.
