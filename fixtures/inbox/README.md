# Inbox PR 1 exam

Today's version, tracker ticket 268. These files contain tests and test setup only.
No inbox, room store, command dispatcher, renderer, or settings implementation was added.

## What was run

Run the new tests with one worker and `TYPESAFE_API_KEY` unset:

```sh
pnpm exec vitest run --maxWorkers=1 programs/inbox \
  apps/fabrika/src/desk/desk.inbox.test.ts \
  apps/fabrika/src/desk/keymap.inbox.test.ts \
  apps/fabrika/src/window/inbox.inbox.test.ts \
  apps/fabrika/src/host/serve.inbox.test.ts \
  apps/fabrika/src/host/settings.inbox.test.ts \
  apps/fabrika/src/messages.inbox.test.ts \
  packages/fabrika/src/host/rooms.inbox.test.ts \
  packages/fabrika/src/program/commands.test.ts \
  packages/fabrika/src/shell/commands.test.ts \
  packages/fabrika-design/src/toolbar.test.tsx
```

Each I1–I20 fails on this branch. The failure names the missing behavior before loading
an absent product file. An import error from a file that exists is never swallowed.
The registry rejection and focus-history checks reach existing code and fail assertions.
The final narrow run collected 33 tests across 13 files. All 33 failed for those
expected reasons; there were no collection or import errors.

The first native-host attempt timed out before its socket became ready. That is not a
law failure. The final tests first check that the absent DM service exists, then start
the real host. After the build, their transport checks still use the production CLI/MCP
bridge, two actual callers, and a test home. They do not replace delivery with a mock.

The first package addition made pnpm attempt an automatic reinstall. Dependency links
were restored from the neighboring checkout. Validation used
`pnpm_config_verify_deps_before_run=false`. The lockfile was generated offline with
`pnpm install --lockfile-only --offline --ignore-scripts`.

One full `pnpm typecheck` stopped at a test-helper type error. That error and the
additional errors found by checking the changed packages were fixed. The four changed
packages have separate targeted type checks. This is not a claim that the whole
workspace passed after those fixes.

The one full `pnpm lint` reached the package-boundary check and found four test imports
crossing package rules. Those imports were removed, without changing the rules or a
ledger. The boundary check and the remaining browser, dead-code, compiler, and token
checks then passed individually. Formatting also runs oxlint, with no blocking finding.

## Laws and plants

`plants.json` gives all twenty wrong changes and the check that must catch each one.
I1, I2, I3, I7, I8 and I11 also have executable in-memory plants beside the real law.
They wrap the production views or tea cells. They cannot be exercised until the product
exists. No plant-kill result or Electron result is claimed here.

| Law | Primary check | Why red on this branch |
|---|---|---|
| I1 | `programs/inbox/src/inbox.laws.test.ts` | No shared inbox program or pair of declared views |
| I2 | `programs/inbox/src/inbox.laws.test.ts` | No grouped inbox containing both sender kinds |
| I3 | `programs/inbox/src/inbox.test.ts` | No unticketed inbox message or reply path |
| I4 | `apps/fabrika/src/host/serve.inbox.test.ts` | No native DM receipt feeding the inbox |
| I5 | `programs/inbox/src/window.test.tsx` | No inbox command declaration with typing scope |
| I6 | `programs/inbox/src/inbox.test.ts` | No reply editor with a kept draft |
| I7 | `programs/inbox/src/inbox.test.ts` | No reply state capturing its recipient |
| I8 | `programs/inbox/src/inbox.test.ts` and `packages/fabrika/src/host/rooms.inbox.test.ts` | No stable reply retry or kept DM acknowledgement service |
| I9 | `apps/fabrika/src/host/serve.inbox.test.ts` | No caller-bound native DM delivery service |
| I10 | `apps/fabrika/src/host/serve.inbox.test.ts` | No caller-scoped native DM read |
| I11 | `programs/inbox/src/inbox.test.ts` and `apps/fabrika/src/host/serve.inbox.test.ts` | No recipient runtime restoring replies or migrating marks |
| I12 | `apps/fabrika/src/desk/desk.inbox.test.ts` | Desk and wire lack program-and-location opening |
| I13 | `apps/fabrika/src/desk/desk.inbox.test.ts` | No inbox tile reuse request |
| I14 | `apps/fabrika/src/desk/desk.inbox.test.ts` | No program open preserving the origin |
| I15 | `apps/fabrika/src/window/inbox.inbox.test.ts` and `apps/fabrika/e2e/inbox.ts` | No D3 inbox look |
| I16 | `programs/inbox/src/window.test.tsx` | No inbox renderer using shared stop details |
| I17 | Command, shell, toolbar, keymap and wire tests | Registry ignores invalid declarations; Open all cannot be rebound |
| I18 | `apps/fabrika/src/host/settings.inbox.test.ts` and program declaration tests | No saved glance choice; undeclared glance machines are accepted |
| I19 | Desk and native-host tests | C-b ; leaves focus on t3; no view-independent inbox runtime |
| I20 | `programs/inbox/src/window.test.tsx` and Electron stage | No grouped inbox renderer or real reply controls |

## Bindings for the build

The plan's interfaces are sketches. The tests bind them to these production entry points:

- `inbox`, with `machines.inbox`, the usual tile `viewOf`, and the new `glanceOf`.
- `InboxWindow` and `InboxGlance`, with today's `{view, send}` props.
- `commandsOf`, `commandFor`, and the shell's `readCommand`.
- `RoomManager.make({storage})`, with caller-bound `for(writer).send/read`.
- Native `dm_send` and `dm_read` tools. Sends resolve a local recipient name.
- `glanceSettings({folder})`, with `choose`, `providers`, and `get`.
- Desk/wire `open_program` carrying `program`, `location`, `from`, and `via`.
- The host publishes `{type: "inbox", now}` and retains the existing Your turn badge message.

`subject.ts` describes messages, observable state and view data. `load.ts` loads real
code and reports missing features. Neither implements the behavior under test. Name
changes from the parallel builds need the tests role to update these bindings.

The summon plan puts `host/rooms.ts` under **packages/fabrika/src**, not the app.
Its planned store is missing here. There is no second conversation store in this exam.

## What the lead must run

```sh
pnpm --filter @kampus/fabrika-app-old e2e -- --inbox
pnpm --filter @kampus/fabrika-app-old e2e -- --inbox-shots
```

The first stage also runs in the normal Electron exam. The second records all 12
states in both looks: the five required layouts, the other three small-window layouts
from U3, 200% text zoom, the minimum tile, and 320 CSS-pixel reflow. That is 264 shots.
It refuses a missing cell and writes every skipped filename to `inbox-captures.json`.
Inbox shots go to `programs/inbox/docs/`; tracker shots go to
`programs/tracker/docs/glance/`. Actual ARIA trees go under the run's shot folder.
`apps/fabrika/aria/inbox/intended.yml` is an authored contract, not a recording.

The lead's run must show real keyboard and pointer input, no focus or scroll change
on arrival, Escape peeling the reply first, a same-row reply, an actual failed save
and successful retry, shared selection, the look moving following rows down, one
reused tile, focus history, live rebinding, a real tracker count, saved glance choice,
and honest queued status after restart. Delivery uses unsummoned fake agents on the
native route, with no paid turn. Failure is real denied I/O in this test home's room
store. No page state or focus is set with `evaluate`.

I1's shared-ask handoff and I20's real-app answering depend on the ask desk's final
view/answer fixes. In particular, S1 must strip the tea Cmd `type` before the shared
answer is sent. The exam keeps `needed=false`, evidence openings, and attention time
through the glance-to-tile move. It must not work around a broken shared answer path.

Inspect every shot and record wrapping, clipping and anything wrong. Run VoiceOver
through both group names, selection, reply, send status, Escape, and tile focus.
The authored ARIA tree and role checks cannot prove spoken behavior.

## What the plan missed

Vitest's existing routing excludes today's `.test.tsx` files. The exam now includes
them and protects those paths. Dynamic loading of the not-yet-built entry points
also needs explicit changed-file triggers, which were added. No design change was
needed. The exact command and native-tool export names were not fixed by the plan.

I10's named plant is underspecified. Reading all rooms and then filtering correctly
can still return only the caller's messages. The stated property forbids returning
another recipient's DM; it does not forbid an internal store read. The two-caller
exam checks all returned bytes. It cannot claim to kill a correct internal filter.

## What this cannot tell us

Electron was not started in this sandbox. There are no received screenshots, screen
reader results, working inbox behavior, native delivery results, or measured plant
kills yet. Missing-feature failures establish that the exam is red before the build;
they do not prove the tests pass against the eventual implementation.
