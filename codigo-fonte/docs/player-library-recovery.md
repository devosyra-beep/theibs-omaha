# Player library recovery

Version 0.14.10 adds **Players → Backup**. Download a local JSON file, select it
to review counts, then explicitly restore. Selecting a file does not write data.

## Scope and safety

- Includes player identities, names, notes, confirmed observations, hand records,
  archived hands and original decision snapshots.
- Excludes authentication credentials, the active table/workspace, presentation
  settings and range templates. This is not automatic cloud synchronization.
- The file belongs to one verified account. Format/version, SHA-256, size (10 MiB),
  references and record structure are checked before any write.
- SHA-256 establishes file consistency, **not authenticity or mathematical
  validity**. Keep the file private; it contains notes and recorded hands.
- Matching records are kept. Conflicting identities or new hands overlapping
  existing player aggregates block the entire restore. V1 does not merge divergent
  histories, sum statistics or reconstruct decision proofs.
- Restored hand IDs receive a durable, separate file-origin receipt. Original
  timestamps, frozen profiles, action sequences and EV/solver snapshots remain
  unchanged. Imported hands cannot establish locally verified forecast timing.
- Restore checks the account, session epoch and storage revision immediately
  before synchronous publication. Quota failures retain the previous complete
  library. Use one editing tab; storage checks are not an atomic cross-tab lock.
- Imported decisions are history only. A successful restore invalidates the
  current displayed analysis instead of installing a saved EV as a live result.

## Validation and alpha gates

Focused gates cover detached round trips, owner/schema/checksum rejection,
prototype and structure limits, exact duplicates, divergent conflicts, reset and
deleted-player history, original snapshot preservation, stale sessions/writers,
quota failures and durable provenance. Browser checks and release receipts live
in `validacao/player-library-recovery/` in the checkout (not shipped).

Release validation: 108 focused tests passed with no skips. Native desktop checks
confirmed preview/cancel, empty-library restore, persistence after reload, duplicate
no-op, checksum-corruption rejection and the archived file-origin label. The
existing Cloudflare build passed. No mathematical source or bundled solver changed.
The integrated browser accepted a viewport override but still rendered at
1280×720; that evidence is desktop only. Its download event did not expose a saved
file path, so native re-import used an independently generated, validated fixture.
Chrome Osyra appeared in inventory but did not answer tab requests. Authenticated
production resume and physical/mobile validation remain unverified.

Remaining real-test gates: authenticated production reload/resume, a physical
phone with both voice languages, and representative p50/p95 first-result latency.
The mathematical coverage is unchanged: no complete strategic Multiway claim,
no additional streets/players, and `INCONCLUSIVE` remains a valid result.
