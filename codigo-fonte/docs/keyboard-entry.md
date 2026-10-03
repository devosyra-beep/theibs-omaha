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
| Left / Right | Select one of your cards or a board position |
| Up / Down | Review the last confirmed action / return to the current Multiway actor |
| F | Record Fold for the current Multiway actor |
| G | Record Check / Call for the current Multiway actor |
| H, amount, Enter | Open legal sizing and confirm Bet / Raise |
| Enter | Return to the current actor, or recalculate equity and EV on your turn |
| Backspace | Remove a card in Card entry, or undo the last confirmed action in action context |
| Shift alone, released | Reset the current hand; chords retain their normal behavior |
| Apostrophe | Reset the Analyze/Multiway hand; new Train hand; Simulation setup |
| Tab / Shift+Tab, Enter, Escape | Access every control, activate it and close dialogs |

Multiway follows one validated actor at a time. F/G/H apply the selected current
actor, even while Card entry has focus and even before your cards are entered.
The next actor is selected only after a successful ledger response. A failed
confirmation keeps the same player available for retry. Repeated commands while
confirmation is pending cannot add another action or open a second sizing form.
Standalone action shortcuts do not start Multiway.

Up reviews only the immediately preceding confirmed ACT; repeated Up never skips
back through players or crosses a board event. Down returns to the current actor
and never advances past that actor. F/G/H cannot apply an action while reviewing;
Backspace undoes the last confirmed action, then returns to that validated player
for correction. Reload restores the current actor rather than a saved arbitrary
seat. Older saved observations require manual removal and never replay on reload.
Native player-popover Fold also follows the current actor; its guarded handler
cannot submit an action for another seat.

In Analyze/Multiway, Shift alone and apostrophe reset the keyboard hand with the
same initial table configuration, clearing private cards, board and recorded
actions. They do not open setup. The ordinary New game button may open setup;
the ordinary next-hand flow after settlement can preserve updated stacks and
rotate positions. Those controls are separate from the keyboard reset. In Train,
apostrophe starts a new training hand; in Simulation it opens its table setup.

Card entry always writes your private hand or the board. Left/Right, Ctrl+1/2/3/4,
rank/suit entry and focusing a card slot never change the selected action player.
Opponents cannot receive cards through Card entry; their controls record actions.
Partial private-card corrections stay in the card draft and cannot change the
confirmed ledger revision used to submit an opponent's action.

At WAIT_BOARD, the keyboard selects the next board position and waits for your
input. Analyze/Multiway never deal community cards automatically. Enter one card
at a time: the first and second flop cards remain a draft; the third commits the
flop without a fourth card or Enter. Turn and river each need one further entered
card. Board entry and street advancement work with an incomplete private hand.
A dirty flush is retried after in-flight work so the final card needs no extra
keystroke. In an all-in runout, the cursor moves to turn and river, but each street
still waits for your card input. Failed board corrections retain their draft;
automatic and manual calculations wait until that board is confirmed.

Equity and EV run automatically once the preceding actions are confirmed, the
history reaches your decision and the required private and board cards have
synchronized. Missing cards block calculation while opponent actions remain
available. Calculation does not run during an action confirmation or on an
opponent's turn. A calculation already in progress never blocks a legal action;
that action cancels the old calculation and its stale results. EV is tied to the
current decision revision. Enter recalculates without applying an action.
Standalone automatic calculation respects its
Settings checkbox.

Simulation uses the same F/G/H commands and selected-player highlight. Enter
retains its current contextual EV-leader, deal, settlement and next-hand flow.
Explicit player actions switch opponents to manual control and pending actions
remain visible. Randomly dealt simulation cards remain part of the original
simulation rules.

Validation: run `node scripts/qa-keyboard-flows.cjs` with Playwright and Edge
available. The test uses real HTTP, isolated storage and physical keyboard input,
including 52 cards, PLO4/5/6, delayed and failed confirmations, restoration,
previous/current actor navigation, independent card/action input, exactly three
user-entered flop cards and real finite equity/EV for the current revision. It
also covers Train, current Simulation and 1515/1024/390/320 pixel layouts. Run the normal
Node suite with the independent LP environment configured through
`THEIBS_REFERENCE_PYTHON`.

Publish through the existing Cloudflare Git branch and verify exact asset hashes
and authenticated keyboard controls on the live address. This frontend release
does not require restarting Render or migrating account data.
