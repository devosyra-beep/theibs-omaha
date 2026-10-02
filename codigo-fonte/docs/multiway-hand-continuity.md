# Multiway hand and game shortcuts

## Current controls

- **Shift alone:** archive the current hand and start the next hand at the same
  table, including during betting or board entry. Player identities, table
  preferences and the planned next-hand setup remain; positions rotate. Cards,
  folds, wagers, decision displays and pending entries reset for the new hand.
- **Apostrophe (`'`) / New game:** open fresh table setup. Starting creates a new
  table with the selected starting stacks and roster, and archives the previous
  hand. Canceling setup leaves that hand active. Saved player profiles/history
  are retained; no prior pot, wagers or ending balances enter the new game.
- **Next hand:** after betting ends, advances directly without a result form.
  **Result · optional** opens payout, shown-card and balance correction tools.

Shortcuts apply only in Analysis/Multiway, outside text fields and open dialogs.
Shift chords, repeats, composition and interrupted key gestures do not reset a
hand. Train is unchanged. Presentation changes and hand transitions do not toggle
the microphone; pending speech from an older hand cannot register a new action.

## Unknown payouts

No payout or ending-stack entry is required. A resolved hand carries its recorded
ending balances. If betting/result is incomplete, continuation uses each player's
previous **starting stack as an estimate**, preserving all seats, including those
whose unallocated all-in chips are still in the old pot. This is a working balance
reference, not an observed refund or a guessed winner.

Seats show **Est. stack**. Estimate flags persist through subsequent hands until
explicit balances are confirmed or a new game supplies fresh starting stacks.
The current EV and legal sizes are conditional on these balances. The previous
ledger, pot, actions, original decision snapshots and unresolved result remain in
History; confirmed action observations remain distinct from unrecorded outcomes.

Archive backup/recovery accepts incomplete ledgers and preserves estimate flags,
canonical revision hashes and the original result. No showdown result, hidden
cards, win statistics or profit are manufactured to advance.

## Validation

Focused gates exercise active-hand reset, unresolved/all-in continuation,
button/identity continuity, known payout accounting, manual balance validation,
stale revisions, keyboard chords, displayed card reset, incomplete archive backup
and browser worker parity. Browser checks and release receipts are stored in
`validacao/hand-shortcuts/` (not shipped). Solver algorithms and coverage are
unchanged; bundled workers/references are regenerated from the session wrapper.
