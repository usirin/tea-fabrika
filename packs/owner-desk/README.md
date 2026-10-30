# @tea-fabrika/owner-desk

An add-on pack: the owner's desk. It hears what waits on the owner, shows an inbox and one page per ask, and hands the owner's answers back to the core.

```ts
import pack from "@tea-fabrika/owner-desk";
import {answerOf} from "@tea-fabrika/owner-desk/reply";

pack.listens; // {waiting: "waiting", settled: "settled", refused: "refused"}: core output -> desk input
pack.answers; // {answer: "answer"}: desk output -> core input

// The owner types a reply. Code reads it; nothing is guessed.
answerOf("/approve");                          // {kind: "approve"}
answerOf("/keep-going 3");                     // {kind: "keep_going", rounds: 3}
answerOf("/no not now: nobody needs this yet"); // {kind: "no", why: "not now: nobody needs this yet"}
answerOf("approve");                           // null: not an answer

// Told to the desk's run, it goes out on `answer`, and the core checks it against the ask.
yield* deskRun.tell("reply", {id: askId, answer: answerOf("/approve")});   // a full mailbox fails MailboxFull
```

## Where it sits

- In `packs/`, the top layer of `layer-rules.json`. Nothing below it may import it.
- It imports `@kampus/fabrika`, `@demlik/tea` and the pipeline, `@kampus/pipeline/*` (the ask and answer shapes, plan lines, criterion marks).
- The pipeline is its own package, in `packages/pipeline/`. `@kampus/pipeline` is a working name, from experiment 114.
- The core imports nothing of it. The core finds it by name from config.
- The root `package.json` lists it, so `loadPacks` can find it from the repo root.
- It decides nothing. Whether an answer fits its ask is the core's call.

## What's in it

The `exports` map has `.` (the pack) and `./*` (any file in `src/`).

| File | What it holds |
|---|---|
| `src/index.ts` | The default export: the `Pack`, and its settings |
| `src/program.ts` | `deskProgram`, the program `owner-desk`. Inputs `waiting`, `settled`, `refused`, `reply`, `typed`; outputs `answer`, `unread` |
| `src/inbox.ts` | The `desk` machine: open asks oldest first, the last refused answer per ask, closed asks. `pagesOf` |
| `src/pages.ts` | What the desk shows, as data: the inbox, one page per ask (plan, stuck, ruling, check), a closed ask |
| `src/view.ts` | `DeskView`, the service a view implements: `show(page)` |
| `src/markdown.ts` | A view: `inbox.md` and `asks/<id>.md` in one folder |
| `src/comment.ts` | A view: one comment per ask on its ticket, and the inbox on a `desk` thread, each edited in place. A stand-in for GitHub keeps each thread in a JSON file |
| `src/reply.ts` | `answerOf(text)`: a typed `/word` reply read into an answer, or `null`. `typedAnswerOf(text)`: the same with the `/` optional |

Reply words `answerOf` reads: `/approve`, `/yes`, `/no <why>`, `/change <line> <text>`, `/remove`, `/keep-going <1-10>`, `/reword <criterion> When <when>, <result>`, `/rule lasting|one-off [build] <answer>`.

The pack has a `shell` part, for a host with a shell:

- `typed` is the input a typed reply goes to. A reply it cannot read goes out on `unread`, and nothing reaches the core.
- `replies(ask)` lists the replies that fit an ask.
- `pages(settings, places)` is the folder the pages go in.

## Settings

Read from its own table in the repository's `fabrika.toml`:

```toml
packs = ["@tea-fabrika/owner-desk"]

[pack."@tea-fabrika/owner-desk"]
view = "markdown"   # or "comment"; "markdown" when left out
dir = "desk"        # where the pages go, read from the fabrika.toml folder; the host's folder for this pack when left out
```

Fabrika's tsh starts this pack when the `packs` line of `fabrika.toml` names it: `desk`, `desk-demo` and `answer` (see `packages/pipeline/README.md`). The host's folder for it is `<TSH_HOME>/packs/owner-desk`, or `<TSH_HOME>/desk-demo/owner-desk` for the demo. `src/desk.test.ts` also wires it by hand, the way a host would.

## Commands

| What | Command |
|---|---|
| Typecheck this package | `pnpm --filter @tea-fabrika/owner-desk typecheck` |
| Test this package | `pnpm vitest run packs/owner-desk` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

`src/desk.test.ts` runs the desk end to end with `ask-log` and `ui-verification`, on the plans and rulings from experiments 86b and 88.

## See also

- [`docs/direction/packs-are-programs.md`](../../docs/direction/packs-are-programs.md): what a pack is and why.
- [`docs/direction/every-wait-is-a-queue.md`](../../docs/direction/every-wait-is-a-queue.md): the desk as the view of every queue a person reads.
- [`docs/direction/ask-for-decisions-not-facts.md`](../../docs/direction/ask-for-decisions-not-facts.md): what the owner is asked.
- [Experiment 89](../../experiments/89-owner-desk.md): the desk as the first pack.
- `packages/pipeline/src/asks/`: the core side, the `asks` program and its ledger.
