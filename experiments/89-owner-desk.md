# 89. The owner's desk as an add-on pack

The question: does "the core emits, a pack answers, the core never knows the
pack" hold for a real pack? The proposal under test is
[packs are programs](../docs/direction/packs-are-programs.md).

**Answer: partly. The naming boundary holds: the core imports no pack and
names none, and the layer gate makes that a lint error. But the packs forced
three changes into the core. None of them names a pack. Two are small and
general. The third matters: a pack that can stop the core's next step
(ui-verification stopping a ship) cannot be a plain listener. The core has to
know how many such packs to wait for. That is a slot, seen from the other
side. Confidence: 75%. No agent ran; $0.**

## Who did what

- **The cases:** the six plans experiment 86b wrote, and four tickets
  experiment 88's sort sent to a ruling (demlik #68, #163, #182, #640), with
  what really happened to each.
- **The core side (`wip/src/asks/`):** new here.
  - `ask.ts`: the ask and answer types, the core's own words.
  - `ledger.ts`: a `Ledger` service, append-only facts, an in-memory layer.
  - `rules.ts`: a pure fold over the ledger. It gives what waits on the
    owner, the stall rule, which builds are ready, and whether an answer fits.
  - `program.ts`: the `asks` program. Facts and answers come in, asks go out.
  - `packs.ts`: the host side. It finds packs by name, checks they fit by
    shape, and wires the loop.
  - `wip/src/stages/plan/lines.ts`: a plan as numbered lines, and what changed
    between two versions.
- **Three packs (`packs/`):** new here, each its own package.
  - `owner-desk`: the inbox and one page per ask. Markdown or a GitHub-comment
    stand-in.
  - `ask-log`: only listens. One line per ask and per answer.
  - `ui-verification`: holds each build. It asks yes or no when a user would
    see the change. The pictures are a stand-in.
- **Config:** `tsh.toml` takes `packs = [...]` and one `[pack."<name>"]`
  table for each pack's own settings.
- Nothing was written to GitHub. No lane ran. No model was called.

## How it is wired

- One config line turns packs on:
  - `packs = ["@tea-fabrika/owner-desk", "@tea-fabrika/ask-log"]`
  - Each package is found from the config's folder, the way Node finds it.
  - Its default export is a `Pack`: a program, the core outputs it hears, the
    pack outputs the core takes, and a layer made from its settings.
- The host checks every wire by shape before anything starts.
  - A pack that is not installed is refused, by name.
  - A pack whose settings do not fit is refused, by name.
  - A package that is not a pack is refused.
- The wiring is a loop: core to pack and back.
  - `pipe` cannot make a loop. Each side would be the other's upstream.
  - So the host starts the packs, starts the core with one listener per
    output, and carries the packs' answers into the core through a queue.
  - Elm's ports are the same loop; there the runtime wires it.
- The core keeps no machine. Its state is a fold over the ledger.
  - A restart rebuilds it, and says every open ask again.
- The desk keeps one machine: what is open, what was refused, what closed.
  - Its pages are a function of that state, as Elm's view is of the model.
  - It shows only the pages that changed, inbox last.

## What the tests show

53 new tests, all on the real cases. Commits on the branch show each red
before its fix.

- **The six 86b plans as approvals, through the desk.**
  - The inbox lists all six, oldest first.
  - Each plan page shows its stories, each criterion with the story it serves,
    its tasks, and each question with the planner's lean.
  - 504's own check still found problems. It goes to the owner anyway, with
    the problems shown: the owner's look is the answer key for now.
  - Five approved, one said no to, by typed replies.
  - 565, changed after its approval, comes back as version 2. Its page shows
    only what changed: one criterion said more tightly, one new criterion,
    the settled question. The other 20-odd lines are not shown again.
  - A `/change t1.c11 ...` on version 2 is taken.
  - The same replies on the markdown view and on the comment stand-in leave
    the same ledger, fact for fact. The view swaps; the core does not change.
- **A stuck task, "keep going 3".**
  - Task 1 of 367 reviewed 4, 3, 3, 3: stuck, no progress.
  - A wrong kind of answer (`/approve`) is refused; the desk shows why on the
    same comment.
  - `/keep-going 3`. Rounds are counted from review facts after the answer.
  - After three more rounds at 3 it asks again: "the rounds you gave are
    spent".
  - `/reword t1.c2 When ..., ...` is taken.
- **demlik #68 ruled through the desk, each branch.**
  - lasting and must be built; lasting only; one-off and must be built;
    one-off only. Each is kept as given.
  - The rules tests also replay the four rulings with what really happened.
- **The ui-verification pack and the desk, through the core alone.**
  - Nothing a user sees changed: no ask, the build ships as usual.
  - Something changed: the desk shows "this is what changes, yes or no?",
    with before and after links. Held until the owner answers. Yes ships it.
  - No, with a note: the note becomes criterion `t1.n1`, build 1 never
    ships, build 2 is checked again, and yes ships build 2.

## Findings

### The boundary

- **The core names no pack.**
  - `packs` sits on top of the layer stack. A deliberate `wip -> packs`
    import, by path or by package name, failed `pnpm lint` with "1 UP".
  - The only pack names in the core are in comments, as `@acme/...` examples.
- **The packs do not know each other.**
  - The desk shows the ui pack's check and keeps the answer, with no import
    of it and no word about it.
  - The ui pack names no desk. With the desk off its check still waits in the
    ledger, and the build stays held.
- **The desk knows every kind of ask the core has.**
  - It imports the core's ask and answer types, as an Elm port handler knows
    the app's port values.
  - Adding the `check` kind broke the desk's typecheck until it could show
    one. That is the right failure: loud, at build time.
  - It never needs to know who raised an ask.

### Core changes the packs forced (none names a pack)

- **A `waiting` output: the whole open list, at the start and on each change.**
  - A desk built on `ask` events alone went stale. Red, then fixed:
    - a plan written again before it was answered left version 1 in the inbox;
    - an ask answered while the desk was off stayed in it after a restart.
  - The reason: an ask can stop waiting with no answer the desk hears, and
    outputs are kept nowhere.
  - The tea-program rule "a late viewer reads machine state" does not reach
    a pack: it cannot read the core's state, so the core must say it.
- **A generic `check` ask: a question, `attachments` (label and ref), yes or
  no with a note.**
  - This is what a pack-to-pack link needs. The core carries the attachments
    and never reads them.
  - The core also gained a small build path: `build` in; `built` and `ship`
    out; `cleared` and `raise` in.
  - A no keeps the build from shipping. Its note becomes a new criterion of
    the task, and the next build is checked again.
- **A `holds` count.**
  - Red first: with listening alone, the core shipped the build before the ui
    pack's check reached it, and dropped the check.
  - A listener cannot stop the core's next step unless the core waits. The
    core cannot wait for a listener it does not know is there.
  - Fix: a pack says `holds: true`. The host counts such packs into the
    core's `holds` flag. Each build waits for that many to clear it or raise
    a check. The core knows a number, never a name.
  - A holding pack on a core with no `holds` flag is refused before it
    starts.
- **Host wiring and config**, as planned: `packs` and `pack` keys in
  `tsh.toml`, and the loop in `packs.ts`.

### With the desk off

- The core runs to its end with nobody listening.
- An ask becomes:
  - an `ask` event nobody hears, and a fact in the ledger;
  - open until answered, from anywhere (a test answers on the core's own
    input);
  - said again at the next start, oldest first.
- Turning the desk on later shows all ten waiting asks.
- A build with no holding pack ships at once.

### Do the answer kinds fit plain inputs?

- Yes. One `answer` input takes every kind, as a schema union.
- The core refuses an answer that does not fit its ask, and says why in
  words: "a ruling ask takes rule, not approve".
- Typed replies read with code alone, and guess nothing: `looks good`,
  `/keep-going 11` and `/rule (b)` are not answers.
- `/no <note>` serves both a plan and a check, with one shape.
- Awkward:
  - kinds are one global union, so the core keeps a table of which kinds
    each ask takes;
  - "change a line" is both the plan change and, in effect, its approval.

### Awkward parts (Elm check)

- **Order across outputs is lost.** Each core output is a separate stream
  into the pack, merged. The desk can hear a `waiting` list sent before an
  answer after it.
  - The desk copes: an ask once closed stays closed.
  - Elm keeps one ordered queue of Msgs. One core output that carries a
    union of events would keep the order.
- **The desk diffs its own pages.** "Show only the pages that changed" is
  Elm's virtual DOM, written by hand.
- **No pipe for a loop.** The host wires core and packs by hand. Elm's
  runtime does this for ports.
- **Criterion keys are places, not ids.** Inserting a criterion moves every
  key after it. Plan diffs match by text for that reason; added criteria get
  `t1.n1`.
- **Pack settings paths are not read from the config's folder.** The tests
  use full paths.
- **The desk's list of closed asks grows forever.**
- **No `operate` loop here.** Builds and ships live inside the asks program as
  stand-ins. The plan stage and ops do not yet carry plan and task ids.
- **The desk tests wait on files.** Under the full suite, two seconds was too
  short; they wait up to ten. Pages are written whole (a temp file, then a
  rename), so a reader never sees half a page.
- Unrelated: one tsh test (kill -9 in the second turn, then resume) failed
  once in several full runs and passed on rerun. Not touched here.

### What should change in the proposal

Not edited here; for the owner to weigh.

- **Split "listens and answers" in two.**
  - A pack that only adds (desk, log) needs nothing from the core.
  - A pack that can stop the core's next step (ui-verification; likely
    on-call and cost) needs the core to wait. It is a slot, or a counted
    hold. "What would change it" names this case. Here the core needed one
    number from the host, not the pack's name, so the idea bends but holds.
- **Any output a pack keeps a list from needs a snapshot output**, said at
  start and on change, not only events.
- **Packs talk through generic ask kinds.** The core needs a "check" ask
  with attachments, so a pack can ask the owner something the core does not
  understand.

## What it cannot tell us

- No live run: no agent, no real GitHub, no real screenshots.
- One process. The ledger is in memory; a restart is a second start on the
  same ledger and storage.
- The build-and-ship path is a stand-in inside the asks program, not
  `operate`.
- Holding builds with two holding packs at once is covered by the fold's
  count, not by an end-to-end test.

## Run it

- `pnpm vitest run packs wip/src/asks` (no agent, no key, $0, about 5 s).
