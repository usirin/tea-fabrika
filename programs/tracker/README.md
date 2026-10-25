# tracker: `@tea-fabrika/tracker`

Tickets on the ledger, and a window to work them. A ticket is one stream of facts: who wrote
each one (a user or an agent), when, and what happened. Nothing else holds a ticket: no copy in
the program, none on GitHub. The fabrika app ([`apps/fabrika`](../../apps/fabrika/README.md))
lists it, so `tracker` typed in the app's tsh opens its window. The design is
[Tickets start in our tracker](../../docs/direction/tickets-start-in-our-tracker.md).

```ts
import {start, tell} from "@kampus/fabrika";
import {Author, tracker} from "@tea-fabrika/tracker";

// What its window sends, on its one input `do`:
yield* tell(run, "do", {kind: "file", title: "Login fails", body: "On main."});
yield* tell(run, "do", {kind: "comment", ticket: 1, body: "Seen it too."});
yield* tell(run, "do", {kind: "close", ticket: 1});

// What lands on the ledger, as the user the `Author` service names:
//   tracker/ticket/1            registered: the number is taken
//   tracker/ticket/1/inbox      {type: "filed", title: "Login fails", body: "On main."}   user:owner
//                               {type: "commented", body: "Seen it too."}                  user:owner
//                               {type: "closed"}                                           user:owner

// What its window is shown (`Shown`), once the facts are read back:
// {ready: true, page: {kind: "list", tickets: [{number: 1, title: "Login fails", state: "closed",
//   comments: 1, at: ...}]}, saving: [], failed: null, problems: [], unreachable: null, quitting: false}
```

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/tracker` | `src/index.ts` | `tracker`, the program: input `do`, one machine `tickets`, and its `view`. `Author`, the service that says who it writes as. No React. |
| | `src/ticket.ts` | The ticket, pure: `Fact`, `Entry`, `Ticket`, `readRow` (a ledger row to an entry, or why it is broken), `fold` (entries to tickets), `Write` and `factOf`. |
| | `src/machine.ts` | The tea machine: what was read, where the window is, the writes on their way. `shownOf` makes the window's view. |
| | `src/ledger.ts` | The only code that talks to the ledger, through the `Ledger` service: `load`, `save`, and the poll. |
| `@tea-fabrika/tracker/window` | `src/window.tsx` | `TrackerWindow`: the list, the composer, a ticket's timeline. Plain React. |

- **The ledger is the only copy.** The machine is not kept. Started again, it reads the ledger
  from the start. Its state is what it read, plus the writes not yet saved.
- **A state change is a fact.** `closed` and `reopened` are facts of their own, never a comment.
- **Writes go one at a time, in the order asked.** Each has a message id made once, so a write
  sent twice is one row. A new ticket's number is the first name `tracker/ticket/<n>` nobody has
  registered yet; a filing that dies half way leaves its number skipped.
- **News from elsewhere shows up.** Once a second the poll asks the ledger for anything after
  the last row it read. A fact an agent writes on the same ledger shows on the timeline, marked
  as an agent's.
- **A bad row is shown, not hidden.** A row that does not read, or a fact that does not fit (a
  comment before `filed`), is kept out of every ticket and listed under "rows did not read".
- **Quit waits for writes.** `{kind: "quit"}` ends the program once every write asked for is on
  the ledger.

## Keys

The common path needs no mouse. The focus goes where the next step is.

| Where | Keys |
|---|---|
| The list | ↑ ↓ or j k pick a ticket, Enter opens it, c goes to the new ticket's title, q quits |
| New ticket | Enter in the title goes to the body, Ctrl+Enter (or ⌘+Enter) files it, Esc goes to the list |
| A ticket | the comment box has the focus, Ctrl+Enter comments, Esc goes back to the list |

- With no tickets, the title has the focus, and the list says what to do.
- After filing, the composer is empty and its title still has the focus, for the next one.
- A half-written ticket or comment stays while you look at another page.

## Left out, on purpose

- Editing a title, a body or a comment. A fact is never changed; an edit would be a new fact.
- Labels, assignees, milestones, search, and a ticket key per project. Not needed to file and
  follow tickets yet.
- Going back to the page you were on after a restart. The list is one key away.
- Retrying a failed write. Its text is shown in full, to copy back.
- Asks, approvals, agents writing to tickets, GitHub sync and the pull request watcher. Each has
  a place: asks are new facts in `Fact`; an agent is another `Author` on the same ledger, and the
  poll already shows what it writes; sync and the watcher are programs that read and write the
  same streams.

## Commands

```sh
pnpm --filter @tea-fabrika/tracker typecheck
pnpm exec vitest run programs/tracker
```
