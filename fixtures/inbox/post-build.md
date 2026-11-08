# Inbox PR 1 after the build

Today's version, ticket 268. Test writer checking build `c1b12df8`, 2026-11-08.
Only tests and this record changed. No ask-desk test or product file changed.

## Exam repairs

- The three key laws now check collisions within each program or global scope,
  reserve the prefix everywhere, and keep bare navigation out of global bindings.
  The lookup law also checks each inbox binding through the real command dispatcher,
  including suppression while typing. Global keys still resolve to their exact rows.
- Both complete palette lists include the six inbox commands and `C-b ;`.
  Their exact order, keys, keycaps, groups, and tsh words remain checked.
- The desk's strict message table generates `open_program`, `start_program_ok`,
  `start_program_err`, `locate_ok`, and `locate_err`. Requests cover inbox and tracker,
  existing and absent origins, null and selected locations, and all four input routes.
  Reply envelopes use commands emitted by the real desk. Each new message has nonzero weight.
- A program start also opens its tile's tsh in `host/serve.ts`. The open/stop law
  counts that command as an opening and still requires exactly the new tiles.
- The exact plant matrix adds the restore law to `foldsUnderFocus`'s failures.
  Every original law and plant remains, including the all-laws-caught assertion.

## Ask-desk reds left unchanged

The checkout still contains the unfinished shared ask view. Its toolbar container
and buttons take Tab, its command filter excludes Later, and its evidence renderer
prints JSON (`programs/tracker/src/ask-window.tsx:457`, `:480`, `:572`).
The ticket window prints the run ID and two Done checks, and has no outer status
region (`programs/ticket/src/window.tsx:154`, `:178`). These are the ask-desk plan's
jobs, as the inbox plan's handoff states.

All ten failures in `programs/ticket/src/ask-view.ask-desk.test.ts` were reproduced:

1. Toolbar has exactly one Tab stop.
2. Shared ask view has a Later button.
3. Plan evidence reads as text, without JSON or tags.
4. Change evidence reads as text, without JSON or tags.
5. Other evidence reads as text, without JSON or tags.
6. Outer polite status region while waiting on an ask.
7. Outer polite status region while running.
8. Outer polite status region when done.
9. Running card hides the run ID.
10. Done card draws one check.

The other seventeen failures were reproduced too:

- `apps/fabrika/src/window/ask-look.ask-desk.test.ts:308`: four button cases in
  each of ticket and tracker differ from the menu, eight failures. The cases are
  Take rec, Not the rec, Needed me, and Every pick's row.
- `apps/fabrika/src/window/ask-look.ask-desk.test.ts:319`: Take rec loses its
  indigo fill in ticket, tracker, and menu, three failures.
- `apps/fabrika/src/window/ask-look.ask-desk.test.ts:329`: focused ticket card
  loses its 8px corners, one failure.
- `apps/fabrika/src/window/ask-look.ask-desk.test.ts:344`: empty status is hidden
  in ticket, tracker, and menu, three failures.
- `apps/fabrika/src/asks.page.ask-desk.test.ts:43`: page data contains the sealed
  recommendation and blind draw, for both hidden values, two failures.

The matching code is still present. The generic button and focused-card rules
override the ask view, and `window.css:2902` hides empty status text. `asks.ts:264`
copies the sealed ask into page data. These seventeen reds belong to the pending
ask-desk fixes as well. This records the checkout, not a live GitHub merge check.

## Socket checks for the lead

A direct Unix-socket listen returned `EPERM`. The following five tests in
`apps/fabrika/src/host/serve.inbox.test.ts` each timed out waiting for the native
host socket, before reaching the law's assertions:

- `:89`, I9, caller identity and person-only answer tools.
- `:120`, I10, caller-scoped DM reads.
- `:156`, I4, receipt without opening a view or moving focus.
- `:192`, I19, receipt after every inbox view closes.
- `:243`, I11, Later/Seen migration and the Your turn Dock projection.

The separate glance-settings test passed. The broad MCP attempt was stopped after
`packages/fabrika/src/mcp/bridge.test.ts:249` timed out on its socket setup. Broader
app/library attempts were stopped; they are not completed suite results. Rerun the
native checks and MCP bridge outside this sandbox. No socket assertion was weakened.

## Validation

- The initial completed app/inbox/command/design run had 1,057 passes, 32 failures,
  and one skip. Five failures were the stale key/palette expectations above;
  the other 27 are listed here.
- After repair, all 236 tests across the three changed test files and nearby
  parser, completion, program, and MCP tool tests passed. Desk plant checks passed.
- The final inbox exam and the three changed files passed all 152 tests after
  formatting. All original laws and plants remain.
- `pnpm format` with the changed paths passed and changed no unrelated file.
  The single `pnpm lint` run passed, with zero blocking findings.
- The app package typecheck ran once and passed. Its desk table remains exhaustive.
- The native-host/settings run completed with five socket timeouts and one pass.

## What this cannot tell us

The socket timeouts prove no delivery behavior. No Electron, screenshot, VoiceOver,
full workspace test run, or paid model run completed here. The lead still needs the
real app checks and the pending ask-desk fixes before judging the whole inbox flow.
