# An old host is named, then restarted

**Decided 2026-10-25 by the owner.** Tracker ticket 12. Nothing here is built.

```ts
// A sketch. What the app does when it finds a host already running on its home.
//
//   the link's version differs      refuse, name both versions, offer "Stop the old host and start this one?"
//   same link, another build        attach, banner "the host runs older code", the same button
//   same link, same build           attach
//   a saved job that no longer fits its machine's schema    that job is refused and says so; the rest open
```

The host outlives the app on purpose: tiles survive Cmd-Q
([the GUI is an Electron app first](./the-gui-is-electron-first.md)). So after a
pull, the new app can meet a host that still runs the old code. This note says
what the app does then.

## 1. The state check comes first

- **Today a saved job is loaded on trust.** The program's storage hands tea
  whatever it read: `migrate: (raw) => raw as S | null`
  (`packages/fabrika/src/program/storage.ts`). An old shape loads as if it were
  new, and breaks later, somewhere else.
- **tea already has the check.** A tea `Store` has a `migrate` step. It answers
  the state, `null` for nothing saved, or `refuse(why)`, and a refused state
  never boots and writes nothing. tea's `schemaMigrate(schema, upcast?)` builds
  one from a schema.
- **The journal does it right already** (`packages/fabrika/src/host/journal.ts`):

```ts
migrate: (raw) => {
	if (raw === null || raw === undefined) return null;
	const exit = decode(raw); // Schema.decodeUnknownExit of the state's own schema
	return Exit.isSuccess(exit) ? exit.value : refuse("not a saved state");
},
```

- **Decided:** each machine hands its state schema to the program's `store`,
  and `migrate` decodes with it, the way the journal does. A job that does not
  fit is refused: "this job was saved by older code, can't open it". The other
  jobs open.
- **No version number on each machine.** The schema is the check. A version
  only matters if old state must be carried forward, and tea's `upcast` is the
  place for that, when it comes.
- **This is Elm's answer.** Elm reads saved data through a `Decoder`, and a
  failed decode is an error to handle, never a guess
  ([Json.Decode](https://package.elm-lang.org/packages/elm/json/latest/Json-Decode)).
  It is also a rule this repo set before: "A saved shape the code does not know
  is refused, not guessed"
  ([one fabrika.toml per repo](./one-fabrika-toml-per-repo.md)).
- **Why first:** the restart below brings jobs back from saved state. Without
  the check, a restart onto new code loads old state on trust.
- **Cost:** a state schema for each machine the host keeps. Some may have none
  in Effect Schema yet, and writing those is the real work.
- **How sure: 85%.** The doubt is that cost. A count of machines with no state
  schema would size it.

## 2. The link's version differs

- **Today:** `attach` answers `Unattached {kind: "version"}` and leaves the old
  host running (`apps/fabrika/src/attach.ts`). The app says so, and the person
  must find and stop the host by hand.
- **Decided: say it plainly, then offer the fix.**
  - The window names both versions: "The host speaks link version 1. This app
    speaks 2."
  - One button: **"Stop the old host and start this one"**. A yes stops the
    host by `<home>/host/pid`, waits for it to exit, starts the new one and
    attaches.
  - Running jobs stop. Their saved lists stay, and each comes back with
    `attach %n`, through the state check above.
  - Reconnect never retries a refused host. The reconnect lane (tracker
    ticket 10) has that rule as a state, `refused`.

```ts
// A sketch. The window's branches when attach answers.
type Found =
	| {kind: "up"} // attached
	| {kind: "version"; theirs: number; ours: number} // refused: name both, offer the restart
	| {kind: "build"; theirs: string | null; ours: string}; // attached, with the banner (section 3)

const restart = Effect.gen(function* () {
	yield* stopHost(paths.pid); // the old host ends, and its running jobs with it
	yield* attach({home, deliver, start}); // no host now: attach starts ours
});
```

- **Others:** tmux refuses a client that speaks another protocol version and
  names both numbers: "protocol version mismatch (client %d, server %u)"
  ([tmux client.c](https://github.com/tmux/tmux/blob/master/client.c)). zellij
  brings a session back after a restart, and "does not immediately run
  resurrected commands", but puts them behind a "Press ENTER to run..." banner
  ([zellij session resurrection](https://zellij.dev/documentation/session-resurrection)).
- **Not taken:** a new host next to the old one, as VS Code runs one server per
  build. It needs its own home, so the person starts on an empty desk. And a
  link that accepts old messages only turns this case into the next one.
- **Cost:** small. A button, a stop by pid, and a wait for exit.
- **How sure: 75%.** The doubt: attaching a job back may send a half-finished
  paid call, or a real comment, a second time. One test on one real job, in
  this lane, would settle it.

## 3. Same link, another build

- **Today nothing tells the person.** The page comes from the new build, and a
  desk message the old host does not know is dropped with a log line, "refused
  a message from a page" (`apps/fabrika/src/host/serve.ts`). Keys do nothing on
  screen.
- **Decided now: the hello names the build.**
  - `apps/fabrika/build.ts` writes a build id into both the app and the host.
  - The host's hello carries it: `{type: "hello", version: 1, build: "a1b2c3d"}`.
    The field is optional, so an older host reads as "build unknown".
  - On a difference, the app attaches anyway and shows a banner: "the host runs
    older code", with section 2's button.
- **Decided for later:** the host restarts itself onto the new build when no job
  runs.
- **Not taken:** refusing any other build. Every pull would stop every job.
- **Cost:** small. A define in the build, a field in the hello, a banner.
- **How sure: 85%.** The banner turns a silent failure into a visible one, at
  little cost.

## The order of work

1. The state check (section 1). It touches only the program's storage and the
   machines' schemas, so it can start now.
2. Sections 2 and 3, after the reconnect lane (ticket 10) merges. Both change
   `attach` and the window, which that lane changes too.

## What it cannot tell us

- Nothing is built.
- The tmux and zellij lines were read in their source and docs. VS Code's one
  server per build comes from a research pass and was not read again. None of
  the three was tried by hand.
- Whether a restart sends a paid call twice is open until the test in
  section 2 runs.
- How many machines lack a state schema is not counted yet.
