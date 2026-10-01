# River HU: conditional 32-combination admission and compact checkpoints

## Scope and release basis

Branch: `hosting/cloudflare-oracle-migration`. Baseline: `5ba76316efa7bd55557cb8e7fe7a807bb0442608`, release 0.14.10. This delivery changes admission and browser checkpoint transport. CFR+, ledger, utility, action-conditioned games, saddle-bound arithmetic, convergence criteria and adaptive candidate selection are unchanged. No new streets, players, payments, Train changes, cloud compute purchases or platform-performance investigation are included.

The serving ceiling becomes **32 explicit combinations per seat / 1,024 worlds** for river HU. A complete game must still pass the 48 MiB conservative tree reservation, 12,000 nodes, 750 ms browser construction deadline and existing working-memory guards. The tested smaller 32×32 game uses 3,073 nodes and 24.008 MiB reservation. The two-size aggression tree requires 72.008 MiB and is refused atomically. 48×48 is not admitted; even its tested minimal tree needs 54.008 MiB.

All declared combinations, joint blockers, positive weights and legal actions in the declared tree are preserved. A smaller tree may omit real poker aggression and therefore remains `APPROXIMATE`. Its value never substitutes for the larger tree's value. No strategy or EV is returned from a refused partial tree.

## Transport and memory ownership

`THEIBS_SOLVER_CHECKPOINT_TRANSPORT_V1` packs CFR regrets and strategy sums into newly allocated binary64 buffers. Native transfer detaches only those transport buffers. Solver matrices remain usable. The host validates the packet and shares one private compact result/checkpoint pair between the active job and cache. Public result views remain detached clones. Resume transfers one fresh buffer copy; the retained cache stays attached through cancellation or watchdog termination. Decoding reconstructs the original matrix values exactly.

Identity, revision, owner, policy, versions, game/context keys, certificates and diagnostics retain their original data. Stale identity is checked before decoding. The transport version is bound on ready/solve and the new codec is included in the generated runtime fingerprint. Every exact serialized input remains part of the cache key, including state, ranges/weights, board, rake, stacks, sizings, utility, abstraction and solver build; no unproved canonicalization is introduced.

Cache quotas remain 4 MiB per entry / 32 MiB total / 16 entries / 24 jobs. Byte accounting includes binary data plus UTF-8 metadata and the public result. These quota units are not a measurement of browser peak heap. The existing 8 MiB combined retained compilation guard is unchanged.

### Bounded checkpoint-only comparison

Three paired native MessageChannel runs on real snapshots, emulating the old `5ba76316` host save/cache/resume operations. Worker pack/unpack costs are recorded separately. This is not an end-to-end browser speed comparison.

| Snapshot | Old host p50/p95 | Compact host p50/p95 | Pack p50 | Unpack p50 | Old / compact accounted bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 24×24 two-size tree | 12.04 / 26.44 ms | 10.05 / 13.74 ms | 9.63 ms | 5.16 ms | 33,456 / 30,072 |
| 32×32 smaller tree | 1.73 / 2.23 ms | 2.16 / 2.23 ms | 1.59 ms | 1.10 ms | 10,810 / 11,436 |

The duplicated host numerical matrix graphs are eliminated: two old graphs become one shared compact buffer. On the smaller checkpoint, validation makes host median slightly slower and sparse JSON is smaller than binary. No universal speedup or browser-heap reduction is claimed. Results and decoded checkpoints matched exactly; cache buffers survived two resumes in independent native-transfer tests.

## Exactness and coverage evidence

- 7/7 new admission gates: 1,024 independent Omaha/cent-ledger payoffs, nonuniform weights, 992 blocker-compatible worlds, refusals and exact fixed-work comparison with `5ba76316`.
- 9/9 independent transport gates: native detachment, two resumes, owner/cancel/stale isolation, baseline strategies/checkpoints/both best responses/bounds and rational containment with zero added tolerance.
- 57/57 capacity/growth/transport/client/adapter gates and 56/56 focused UI/voice-parser/keyboard gates passed with no skips.
- Independent reference rerun: 17 cases, 16 LP cases, 37 actions, 74 strict interval-containment checks, 37 adaptive action containment checks and 120 terminal payoffs passed. LP reference applies to those small games; no 24/32/48 LP reference is claimed.

Current-hand EV against the returned strategy, full-prior values/bounds with one private information-set action committed, and global NashConv remain distinct. `SOLVED` describes subgame qualification; it does not imply conclusively separated actions. NashConv is not converted into a confidence interval. Existing adaptive refinement preserves every competitive action until valid comparable bounds certify dominance.

Nested raw weights preserve older hands but normalization changes the prior. Hero's actual-hand mass falls from 1/300 at 24 to 1/528 at 32 and 1/1176 at 48. In the same smaller tree, CHECK profile EV changes from 1.186667 to 0.674242 bb while remaining the point leader. This is range sensitivity, not numerical error. Since 48 is refused, a three-way EV/action stability claim is unsupported.

## Native browser evidence before publication

Three cold clients and a FAST read of each identical completed snapshot, using actual STANDARD 3,000 ms / 1,000 work initially and an unchanged 5,000 ms cumulative adaptive ceiling. p95 is the maximum of three observations, not an SLA.

| Declared tree | First value p50/p95 | Completion p50/p95 | Action-certificate cost p50/p95 |
| --- | ---: | ---: | ---: |
| 12×12 two sizes | 265 / 933 ms | 536 / 2,023 ms | 33.5 / 197.9 ms |
| 24×24 two sizes | 322 / 327 ms | 1,073 / 1,105 ms | 67.6 / 68.6 ms |
| 24×24 no additional aggression | 217 / 318 ms | 383 / 472 ms | 24.2 / 25.2 ms |
| 32×32 no additional aggression | 265 / 371 ms | 603 / 636 ms | 28.8 / 59.4 ms |

Both refusal cases returned `NOT_SOLVED` with no EV. The 24 two-size tree retains strict `INCONCLUSIVE` with overlapping certified intervals and a separate full-prior `NEAR_EQUIVALENT` outcome. The smaller 32 tree has separated commitment intervals within its declared approximate tree; this does not certify full-hand optimality.

Local mathematical self-test: 17 checks passed, including a conclusive game, a `SOLVED` true tie, a non-tied overlapping case and an unsupported fee model. Typing/tapping stayed available during compute. Local game smoke validated keyboard entry, setup, Call, cent-ledger pot/stack changes, Undo, cards preserved when closing voice options, and `This device only`. Desktop and actual 393 px browser-viewport screenshots were captured; mobile document width was 378 px, with no horizontal overflow. No physical phone, microphone or human acoustic test was performed.

## Publication and remaining limitations

The existing Git-connected Cloudflare build and manual Render backend deployment must both reference the release commit. Production HTTP assets, health/version, authenticated-route protections, native browser cold/warm, bound separation/overlap, cancellation and cache invalidation are checked after deployment. At commit preparation, production validation is **PENDING**. After deployment the final receipt will be stored in the workspace under `validacao/river-hu-32-transport/PRODUCTION_RECEIPT.json`; it will record the exact active commit/deploy, final measurements and any unverified flows. No production success is inferred from build alone.

The first useful response target remains about three seconds with independent UI/voice/keyboard and background refinement. Arbitrary ranges, richer trees, old phones, auth/network/backend cold start and a certified mathematical conclusion are not guaranteed within three seconds. Render remains required for authenticated backend routes; the public browser fixture does not measure its cold-start latency. Full PLO5 Multiway is not solved and 48-combination EV remains unknown.

## Reproduction and raw records

From `codigo-fonte`:

```text
node test/helpers/benchmark-river-hu-range-sensitivity.cjs
node test/helpers/benchmark-river-hu-checkpoint-transport.cjs
node --test test/solver-river-hu-32-admission.test.cjs test/browser-solver-checkpoint-independent-qa.test.cjs
node scripts/build-browser-solver.cjs --check
```

See [range study](benchmarks/river-hu-range-sensitivity.json), [transport measurement](benchmarks/river-hu-checkpoint-transport.json), [native local measurements](benchmarks/river-hu-32-browser-local.json) and [small independent contract reference](benchmarks/river-hu-expanded-contract.json).
