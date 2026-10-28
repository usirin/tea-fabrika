# tracker: `@tea-fabrika/tracker`

Tickets on the ledger, and a window to work them, with the open pull requests of the connected
repositories beside them. A ticket is one stream of facts: who wrote each one (a user or an
agent), when, and what happened. Nothing else holds a ticket: no copy in the program, none on
GitHub. The tracker works like Linear, tied to no repository: GitHub comes in through an
integration of its own. The fabrika app ([`apps/fabrika`](../../apps/fabrika/README.md))
lists it, so `tracker` typed in the app's tsh opens its window. The design is
[Tickets start in our tracker](../../docs/direction/tickets-start-in-our-tracker.md).

```ts
import {start, tell} from "@kampus/fabrika";
import {Author, tracker} from "@tea-fabrika/tracker";

// What its window sends, on its one input `do`:
yield* tell(run, "do", {kind: "file", title: "Login fails", body: "On main."});
yield* tell(run, "do", {kind: "comment", ticket: 1, body: "Seen it too."});
yield* tell(run, "do", {kind: "close", ticket: 1});
yield* tell(run, "do", {kind: "show", show: "all"});      // open (the start), closed or all
yield* tell(run, "do", {kind: "find", text: "login"});    // titles with "login", any case

// What lands on the ledger, as the user the `Author` service names:
//   tracker/ticket/1            registered: the number is taken
//   tracker/ticket/1/inbox      {type: "filed", title: "Login fails", body: "On main."}   user:owner
//                               {type: "commented", body: "Seen it too."}                  user:owner
//                               {type: "closed"}                                           user:owner

// What its window is shown (`Shown`), once the facts are read back:
// {ready: true, page: {kind: "list", tickets: [{number: 1, title: "Login fails", state: "closed",
//   comments: 1, at: ...}], pullRequests: [...], counts: {open: 0, closed: 1, pullRequests: 0}},
//   filter: {show: "all", find: "login"}, github: {read: true, why: null},
//   saving: [], failed: null, problems: [], unreachable: null, quitting: false}
```

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/tracker` | `src/index.ts` | `tracker`, the program: input `do`, one machine `tickets`, and its `view`. `Author`, the service that says who it writes as. No React. |
| | `src/ticket.ts` | What a person writes, pure: `Write` (a comment can ask for changes, an answer carries the text it saw) and `factOf`, and `Summary`, a ticket on the list. The facts themselves, `WRITTEN_BY`, `Entry`, `Ticket`, `readRow` and `fold`, are the pipeline's, in `@kampus/pipeline/tickets/ticket`, so a lane writes the same facts this window shows. |
| | `src/head.ts` | A ticket's top line, pure: `headOf(timeline, now)` (done, closed, asks, running, stuck, idle, next, in that order), `openAsksOf`, and `lineOf`, the line in words. |
| | `src/rows.ts` | One short row per fact, `rowsOf`, made on the host with the pipeline's `endedAs`. |
| | `src/machine.ts` | The tea machine: what was read, where the window is, the writes on their way. `shownOf` makes the window's view. |
| | `src/ledger.ts` | The only code that talks to the ledger, through the `Ledger` service: `load`, `save`, and the poll. |
| | `src/pull-requests.ts` | `PullRequest`, and the `PullRequests` service the program reads open pull requests through: `pull_requests`, and the wait between reads. `pullRequestsOf(list)` for a test. |
| `@tea-fabrika/tracker/github` | `src/github.ts` | The GitHub integration: `gitHubPullRequests(settings)`, `PullRequests` on the pipeline's `CodeHost`, and `GITHUB`, the connected repositories. |
| `@tea-fabrika/tracker/window` | `src/window.tsx` | `TrackerWindow`: the filter and search, the list, the pull requests, the composer, a ticket's timeline. Plain React. |
| | `src/links.ts` | `piecesOf`: a body cut into text and links, by GitHub's autolink rule, for http and https. Pure. |

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
- **A ticket shows one top line,** folded from its facts
  ([What a ticket shows](../../docs/direction/what-a-ticket-shows.md)): "done: PR #12 merged",
  "closed by owner", "waits on you: approve plan v2", "build running, task t-2", "stuck: read
  failed", "idle since 14:02", "next: review". An open ask always wins on an open ticket. Nobody
  writes "done": it is a merged pull request, or a person's close once the asks are answered.
  "Idle" needs the time, so a `clock` Sub ticks once a minute into the state.
- **An open ask has a box.** While an `asked` has no `answered`, the ticket's page shows it with
  one button per pick and a note. A click sends `{kind: "answer", ...}`. A comment never answers.
  Only a person answers: a tracker whose `Author` is an agent refuses it, and the fold keeps an
  agent's `answered` out.
- **Quit waits for writes.** `{kind: "quit"}` ends the program once every write asked for is on
  the ledger.
- **A URL in a body is a link.** Only http and https, and only in a ticket's or a comment's body,
  not in a title. Where a URL ends is GitHub's rule (`src/links.ts` has it whole): a trailing
  `.` `,` `:` `!` `?` `*` `_` `~` `'` `"` is left out, and so is a `)` that closes no `(`.

  ```ts
  piecesOf("Or (https://example.org/x).")
  // [{kind: "text", text: "Or ("}, {kind: "link", url: "https://example.org/x"},
  //  {kind: "text", text: ")."}]
  ```

  A link shows its own URL and is `target="_blank"`: the app hands it to the person's own
  browser, and its window stays where it is
  ([`apps/fabrika`, "Links"](../../apps/fabrika/README.md#links)).
- **Closed tickets are hidden at the start.** What the list shows (`show`: open, closed or all)
  and the search (`find`) are the machine's state, as Elm keeps a filter in the Model: the view
  is a pure function of them (`shownOf`), the laws in `src/filter.laws.test.ts` hold it, and a
  second window on the same run sees the same list. Which row is picked stays the window's: it
  is focus, not data.
- **Open pull requests sit beside the tickets.** They come through the `PullRequests` service, read
  at the start and then two minutes after each answer. In the app it is
  `gitHubPullRequests(GITHUB)`: the
  pipeline's `CodeHost`, on the person's own `gh` login, so the tracker holds no token and the
  window never sees one. A pull request shows its repository's short name, number, title, a
  draft mark and when it last moved, never who opened it. Enter on one opens it in the browser.
  A read that fails says so under "Pull requests" and keeps the last list. The connected
  repositories are one list, `GITHUB.repos` in `src/github.ts`.
- **A pull request's title is anyone's words.** On a public repository anyone can open one. The
  window only draws it; nothing reads it as an instruction.

## Keys

The common path needs no mouse. The focus goes where the next step is.

| Where | Keys |
|---|---|
| The list | ↑ ↓ or j k pick a ticket or a pull request, Enter opens it, o x a show open, closed or all tickets, / goes to the search, c goes to the new ticket's title, q quits |
| The search | typing narrows tickets and pull requests by title; Esc, ↓ or Enter goes back to the list |
| New ticket | Enter in the title goes to the body, Ctrl+Enter (or ⌘+Enter) files it, Esc goes to the list |
| A ticket | the comment box has the focus, Ctrl+Enter comments, an open ask's buttons answer it, Esc goes back to the list |

- With no tickets, the title has the focus, and the list says what to do.
- After filing, the composer is empty and its title still has the focus, for the next one.
- A half-written ticket or comment stays while you look at another page.
- The window has no colours of its own: it draws with the app's tokens
  (`apps/fabrika/src/window/window.css`), as every program's view does.

## Left out, on purpose

- Linking a pull request to a ticket. It is next: a link is a fact on the ticket's stream, as
  [What a ticket shows](../../docs/direction/what-a-ticket-shows.md) section 5 says.
- More than the first 100 open pull requests of a repository, and pull requests that are not
  open.
- Editing a title, a body or a comment. A fact is never changed; an edit would be a new fact.
- Labels, assignees, milestones, and a ticket key per project. Not needed to file and follow
  tickets yet.
- Going back to the page you were on after a restart. The list is one key away.
- Retrying a failed write. Its text is shown in full, to copy back.
- Anything that writes a lane's facts for real: the pipeline's lanes, ticket sync with GitHub and
  the pull request watcher. The facts are in `Fact` and only tests write them today; each writer
  is another `Author` on the same ledger, and the poll already shows what it writes.
- A running agent's live row, its beats and its log (section 3 of the note). It is next.
- Sorting the tickets that wait on the owner first on the list.
- Markdown in bodies, for now. Agents write Markdown, so it is next: `[text](url)` shows as
  written today, with its URL a link. A Markdown link whose text is not its URL will need the
  person to see where it goes before the click.

## Commands

```sh
pnpm --filter @tea-fabrika/tracker typecheck
pnpm exec vitest run programs/tracker
```
