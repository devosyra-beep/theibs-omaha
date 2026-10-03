# Keyboard entry release

The keyboard release extends the current 0.14.10 frontend. Engine source, API
contracts, solver builds and the Render backend retain their existing versions.

`keyboard-commands.js` maps physical keys to commands and owns the PT-BR/English
bindings. `keyboard-controller.js` owns global input, selection, focus and the
mutation queue. Card, Multiway, Train and Simulation components expose semantic
adapters. Text fields and open dialogs retain native editing and Tab navigation.

| Key | Behavior |
| --- | --- |
| A, 2–9, D/T/10, J, Q, K then E/C/O/P | Card rank then suit, including with Cards collapsed |
| Left / Right | Select a card position |
| Up / Down | Select any player |
| F | Capture Fold for the selected player |
| G | Capture Check / Call for the selected player |
| H, amount, Enter | Open sizing immediately and capture Bet / Raise |
| Backspace | Correct the contextual card or remove a pending observation |
| Shift alone, released | Reset the current hand; chords retain their normal behavior |
| Apostrophe | New hand/table setup, depending on the workspace |
| Tab / Shift+Tab, Enter, Escape | Access every control, activate it and close dialogs |

Multiway accepts observations for any selected seat. Eligible off-turn folds
use the existing ledger operation. Other observations remain visible until that
seat can legally act. The queue never invents intermediate actions or changes
the mathematical turn. User selection changes synchronously; delayed responses
cannot redirect it.

Simulation uses the same F/G/H commands and selected-player highlight. Enter
retains its current contextual EV-leader, deal, settlement and next-hand flow.
Explicit player actions switch opponents to manual control and pending actions
remain visible. Randomly dealt simulation cards remain part of the original
simulation rules.

Validation: run `node scripts/qa-keyboard-flows.cjs` with Playwright and Edge
available. The test uses real HTTP, isolated storage and physical keyboard input,
including 52 cards, PLO4/5/6, delayed replies, restoration, out-of-order actions,
Train, current Simulation and 1515/1024/390/320 pixel layouts. Run the normal
Node suite with the independent LP environment configured through
`THEIBS_REFERENCE_PYTHON`.

Publish through the existing Cloudflare Git branch and verify exact asset hashes
and authenticated keyboard controls on the live address. This frontend release
does not require restarting Render or migrating account data.
