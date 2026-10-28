# Tickets start in our tracker

Decided 2026-10-24, for the pipeline's first version.

```ts
// A sketch. A ticket is facts on the ledger. No stage reads a GitHub issue.
{fact: "filed", ticket: "demlik-1", by: "owner", title: "…", body: "…"}
{fact: "edited", ticket: "demlik-1", by: "owner", body: "…"}
{fact: "commented", ticket: "demlik-1", by: "agent", body: "Plan ready. One open point: …"}
{fact: "approved", ticket: "demlik-1", plan: "demlik-1", version: 2, text: "sha256:9c1f…"}

// The approval names the text it saw. An edit after it is not covered.
// A JSON pair, so "ab" + "c" and "a" + "bc" do not share a hash (experiment 138).
const covers = (approval: Approved, now: Ticket) =>
	approval.text === sha256(JSON.stringify([now.title, now.body]));

// The window: every fact, oldest first, then a box for each ask still open.
const view = (facts: TicketFact[]) => [...facts.map(row), ...openAsks(facts).map(box)];
```

## What was decided

- **The tracker is part of the first version.** It is a program: tickets are
  facts on the ledger, and its window is the form to file one. As
  [the GUI note](./the-gui-is-electron-first.md) says, every window in the app
  is some program's view, so a form cannot exist outside a program.
  - ~~It is not a whole Linear. No boards, no cycles, no priorities: those wait
    for a run that needs them, as
    [the smallest ledger](./smallest-ledger-proof-to-grow.md) says.~~
    Replaced 2026-10-27: the tracker is built like Linear, as the base the
    pipeline, milestones and packs build on
    ([the tracker is like Linear](./the-tracker-is-like-linear.md)).
- **A ticket's window is its timeline** (decided 2026-10-24). Every fact about
  the ticket shows in one list, oldest first: filed, edited, comments, each
  stage's answer. It is the one place to see what is being done.
  - When something waits on the owner, the open ask
    (`packages/pipeline/src/asks/ask.ts`: plan, stuck, ruling, check) shows as
    a decision box after the last entry. The owner answers there, not in a
    chat. The answer is a fact, and the agent reads it when it next runs. The
    work between the owner and the agents is async.
  - Comments are part of it (decided 2026-10-24). A comment is talk. An approval
    or a ruling is an answer in a box, a fact of its own, so a comment never
    changes what an approval covers.
  - **A comment can also request changes** (decided 2026-10-24, in the first
    version). The comment form has two buttons, as GitHub's review box has
    "Comment" and "Request changes". A user's "request changes" after an approval
    stops build and asks for a new plan or a new approval; an agent's never does.
    The person says which it is, so nothing guesses.
    ```ts
    {fact: "commented", ticket: "demlik-1", by: "owner", body: "Skip part 2.", asks: "changes"}
    // the approval before it no longer covers the lane; build waits for a new plan or a new approval
    ```
  - Only a person in the window can answer a box. No agent writes an answer,
    as [AGENTS.md](../../AGENTS.md) already says.
  - GitHub shows a pull request the same way: comments, pushes and reviews in
    one list. Its required reviewers for a deployment answer in a box inside
    the run's own page
    ([GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)).
- **The first demlik ticket is filed there,** not as a GitHub issue. Triage,
  plan and every later stage read it from the ledger.
- **Only people on the ledger can file or edit a ticket.** A stranger has no
  way in. On a public GitHub repo, anyone can open an issue or comment on one.
- **An approval covers the text it saw.** The owner's approval of the plan records a hash
  of the ticket's text. An edit after the approval needs a new approval before build
  starts.
- **GitHub stays the code host.** Pull requests, checks and the merge queue
  stay on demlik, through `CodeHost`, as
  [the ledger note](./ledger-behind-a-service.md) says.

## Decided 2026-10-26: GitHub is an integration

- **The tracker works like Linear.** It is tied to no repository. Tickets live
  on the ledger, and GitHub is one integration of the tracker's own.
- **The integration reads through `CodeHost`,** the pipeline's one GitHub
  client, on the person's own `gh` login. No second GitHub client, and no new
  token: the tracker never holds one, and its window never sees one.
- **Connected repositories are a list** in the integration's settings. It
  starts with this repository. Adding one is one line.

```ts
// programs/tracker/src/github.ts
export const GITHUB: GitHubSettings = {repos: ["https://github.com/usirin/tea-fabrika"]};

// apps/fabrika/src/host/main.ts: the tracker's `PullRequests`, on CodeHost, on the gh login
const pullRequests = Layer.provide(
	gitHubPullRequests(GITHUB),
	gitHubCodeHost({own: [], reviewers: []}),
);
```

- **What it does first:** the list shows the connected repositories' open pull
  requests beside the tickets. It is a view: it writes no fact.
- **Next, not yet:** linking a pull request to a ticket. That link is what lets
  a merge make the ticket done
  ([What a ticket shows](./what-a-ticket-shows.md), section 5), so it is a
  fact on the ticket's stream, not window state.
- **Why:** one GitHub client means one place for auth, limits and the shapes
  GitHub answers in. The person's `gh` login is already there and already
  scoped to them.
- **Cost:** the app needs `gh` on its path and logged in. Without it the list
  says it could not read pull requests, and tickets work as before.

## Why

- **Who can write the ticket is the guard that holds.**
  - An agent can be steered by text it reads. Twelve published defenses all
    fell to adaptive attacks
    ([Willison](https://simonw.substack.com/p/new-prompt-injection-papers-agents)).
  - So the pipeline limits who writes what an agent reads. Meta's Rule of Two
    says one agent session should have at most two of: input nobody trusts,
    private data, and the power to change things outside
    ([Meta](https://ai.meta.com/blog/practical-ai-agent-security/)).
  - Triage reads the ticket first, with nothing in its box. With the tracker,
    the ticket is no longer text from a stranger.
- **Binding an approval to what it saw is common practice.**
  - GitHub can mark an approval stale when a pull request's diff changes
    ([GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
  - Gerrit drops a vote on a new patch set unless the label's
    `copyCondition` keeps it
    ([Gerrit](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).
  - This repo already does it for review: a review records which ticket
    version it judged ([done is per criterion](./done-is-per-criterion.md)).
- **It was the end state anyway.** The ledger note names fabrika's own tracker
  as where this goes. This moves it into the first version.

**Cost:** one program with a window, three new facts and a hash. Tickets are no longer
public, so a demlik maintainer cannot see why a pull request exists unless it
says so on GitHub (see below).

**How sure: 80%.** The doubt is the extra work before the first ticket can
run. What would settle it: building the form and seeing how small it is.

## Still open

- **A change of mind sent as a plain comment.** "Request changes" (above)
  covers it only when the person picks that button. A person who picks
  "Comment" by habit leaves the approval in place. How often a user's plain
  comment after an approval changes the ask would tell us if more is needed;
  experiment 138 counted edits after the approval, not comments.
- **demlik asks each pull request to close a GitHub issue.** Its `CLAUDE.md`
  says to write `Closes #N`. Decided 2026-10-24: **no copy of a ticket goes to
  GitHub.** demlik's rule changes instead, since demlik is the test bed.
  - Stages read the ticket from the lane's own fact, never from a pull
    request's body. Today `ticketIn` and review's `no_ticket` check read
    `Closes #N` from the body, so they change.
  - [Experiment 138](../../experiments/138-tracker-on-demlik.md) found no
    outsider ever wrote a demlik issue or comment, and demlik's CI reads none
    of the link.
  - The earlier lean, a one-time copy on GitHub (70%), was wrong: comments on
    a copy reach nobody.
- **How a pull request's status reaches the ticket.** Lean for the first
  version (2026-10-24, 80%): a watcher program on the ledger's host reads each
  open pull request on its own Durable Object alarm and writes a `pr` fact
  when something changed. Today `CodeHost` asks GitHub again every few seconds
  (`packages/pipeline/src/code-host-github.ts`); the watcher sits behind the
  same `CodeHost` streams, so no machine changes.

  ```ts
  // A sketch. The same code in Miniflare on a laptop and on Cloudflare for a team.
  async alarm() {
  	for (const pr of openPrs()) {
  		const now = await codeHost.read(pr, {etag: pr.etag}); // 304 when nothing changed
  		if (now.changed) await ledger.append({fact: "pr", ticket: pr.ticket, head: now.head, checks: now.checks});
  	}
  	if (openPrs().length > 0) await setAlarm(Date.now() + 15_000);
  }
  ```

  - An unchanged read does not count against GitHub's rate limit
    ([GitHub](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)).
    GitHub's own advice is webhooks over polling; a few open pull requests
    stay far inside its limits.
  - An alarm runs at least once and is retried when it fails
    ([Cloudflare](https://developers.cloudflare.com/durable-objects/api/alarms/)).
    Each pass is a fresh read, so a missed pass loses nothing.
  - Its own program, not the ledger: a Durable Object has one alarm, and the
    ledger's is for leases.
  - Cost: status up to 15 s late, and a read-only GitHub token where the
    watcher runs.
- **Later: webhooks through a tunnel to a local server.** A tunnel such as
  Cloudflare Tunnel connects outward only and needs no public address
  ([Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)).
  It would let GitHub, and other services, reach the app on a laptop. Not for
  the first version. Whatever reaches the tunnel reaches the laptop, so only
  the webhook path is served, and every delivery's signature is checked
  before anything else reads it.
- **Ticket ids.** `demlik-1`, in Linear's style of a team key and a number, is
  a guess.
- **The form.** The tracker program's window. `tsh` can drive the same
  program before the window exists.

## What would change it

- A stage that needs something only a GitHub issue gives.
- A form that turns out much bigger than a few fields.

## What it cannot tell us

Nothing has run on a real tracker. Experiment 138 read demlik's history only.
No ticket has been filed this way, and no stage reads a
ticket from the ledger yet.
