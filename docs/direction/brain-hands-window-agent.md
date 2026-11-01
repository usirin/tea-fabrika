# Brain, hands, window, agent

**Decided 2026-10-31.** This note is about the new version: `next/` and
[the five layers](./a-local-first-sync-engine.md#decided-2026-10-30-and-2026-10-31-five-layers-central-first).
The word "peer" is gone, and so is "node" as a word for a machine or a
participant. Three things dial the brain: **hands**, a **window** and an
**agent**. `client` means any of them, and only when we talk about the door's
protocol. A **host** is a place hands can run: a Mac, a VM or a browser profile.
What a host can do is its **capabilities**.

**Tier 1 builds the shape.** Each platform Layer says what its host can do, and
the hello carries that list from the first day, because old hellos can never get
it back. **Proposed, not decided:** a tab that runs jobs. That waits until hands
are built for real, with the queue and leases.

```ts
// A sketch. Two hosts and one brain.
//   the Mac             capabilities: git, files, agents
//   a Chrome profile    capabilities: screen, clipboard, notify
//   the brain           runs programs and keeps their state
//
// A platform Layer names its host's capabilities, and the hello carries them.
// The key on the wire stays `has`.
Layer.succeed(Host, {kind: "browser", has: ["screen", "clipboard", "notify"], cannot: ["Mod-W"], tab});

{"key": "ed25519:mac...", "has": ["git", "files", "agents"]}              // the Mac's hands
{"key": "ed25519:w1...", "tab": "t1", "has": ["screen", "clipboard", "notify"]} // a tab
// A Cmd that `needs` git never goes to that tab. How a client says it takes jobs
// at all is not designed yet: a tab that only draws has capabilities too.
```

## The words

Keep `client` boring. "The client dials." "One gateway per client." "One key per
client." When one kind is meant, name that kind.

| Word | Means | Say it like |
|---|---|---|
| hands | what takes jobs from the queue | "the Mac's hands took c-41" |
| window | what draws and sends a person's keys | "two windows show build:7" |
| agent | an agent, through the bridge | "the agent posts a fact" |
| client | any of the three, at the door | "the client signs its hello" |
| host | a place hands can run | "the Mac is a host, and so is that Chrome profile" |
| capabilities | what a host can do | "only the Mac has git" |

A ledger entry's `said` is "the writer's own clock".

## Hands and window are jobs, not places

They do different work, and they fail differently.

```ts
// A sketch. Ticket #7.
// Hands: one takes each job, with a lease.
//   the Mac's hands claim c-41 and crash; the lease runs out; the VM's hands take c-41
// Windows: all of them mirror one view.
//   w1 and w2 show build:7; w1 dies; w2 still shows it, and nothing is lost
```

Temporal splits the work the same way:
[Workers run tasks, Clients start and query](https://docs.temporal.io/develop/typescript/client/temporal-client).

The split is about the work, so one tab can do both: draw as a window and take
jobs as hands. A Mac window draws while the Mac's hands run elsewhere. A browser
tab has no elsewhere, so it may hold both.

## Capabilities

- **The word is the industry's.** MCP's client and server state their
  [capabilities when they start](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
- **The key stays `has`,** next to `needs` on a Cmd. Short everyday keys are the
  rule here, and it reads as a sentence.
- **Capabilities are what stops a tab from getting a build.** Not the names. A
  tab can't run a process, so it never says it has one, and the queue never
  offers it that job.
- **A capability says "can", never "may".** A client can claim anything in its
  hello. A false claim gets it jobs it fails. Whether a client may do something
  is a grant, on the ledger.

## Why a browser is a host

These are ideas, and none is tried yet.

- Real browser checks: screenshots in real layouts, a real Safari.
- Jobs that need a person there: passkeys, login flows, clipboard, file picker.
- Hands with no install: a collaborator on Windows, or a phone.
- With the laptop closed: the cloud brain has no hands, and an open tab could do
  browser-safe jobs.
- A sealed program could run in a Web Worker, since it names no platform.

VS Code does this. Its
[web extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)
runs extensions in a browser Web Worker, and `extensionKind` says which side an
extension prefers.

The limits are real. A tab can't start a process, so there's no `claude`, no
`git` command and no real build. Closing a tab kills its job, and the lease
handles that like a crash. Only one tab in a profile should act as the hands, and
[Web Locks](https://developer.mozilla.org/docs/Web/API/Web_Locks_API) can pick
it.

## The other answers we weighed

- **A window is a set of hands with a small `has`, and there is one word.** This
  was the strongest, because every client speaks the same wire. It wasn't picked
  because the work differs: one set of hands takes a job with a lease, and all
  windows mirror one view. Calling both "hands" makes people ask which window
  holds a lease. What it got right stayed: a tab may be both.
- **`host` for every client.** A host is where things run, and a client is what
  dials. Three tabs in one profile are three clients on one host, since the
  key already belongs to the profile.
- **`host` means only a computer.** That's how
  [RFC 1122](https://www.rfc-editor.org/rfc/rfc1122.txt) uses it, and it was this
  note's first answer. It left no word for a browser that runs jobs.

## Why not the other words

- **Not "peer".** Too vague: it says nothing about what the thing does. It also
  sounds like an equal you talk to directly, and these never do. Every one dials
  the brain and meets the others through it (T1 and T2 in the five layers).
- **Not "node".** In Erlang a node is a running machine, and that word stays when
  we name OTP. As a word of ours it says nothing about what the thing does.

## What it costs

- One note moved and about 70 lines reworded across the direction notes and
  `AGENTS.md`. No code changed.
- A search still finds "peer" in 25 files in `experiments/`. Those are records of
  their time, so they keep it.
- `host` still means something else in today's version: a running process that
  hosts programs. Check the path before you trust the word.
- Our `host` is wider than RFC 1122's, so a reader may picture a computer first.

**How sure:** 70%, for the words and for a browser host. Three doubts:

- **Job code beside the window's key.** It could sign as that window, so a job
  must run sandboxed before a tab runs anything we didn't write. Nobody has
  designed that yet.
- **Whether enough real jobs exist for a browser.** A first browser job would
  settle it.
- **Capabilities that change.** A tab can lose the screen when it's hidden, while
  the hello is said only once. Today's `has` assumes they don't change.
- **Saying "I take jobs".** `has` describes the host, so it can't also say whether
  this client wants work. That needs its own answer before a tab runs a job.

## What it cannot tell us

- Whether the words stay clear once code uses them. No code in `next/` uses them
  yet.
- How well an agent fits beside the other two. Hands and windows have a written
  place in the transport layer. An agent's trip through the bridge has less
  written down.
- What to call the place the brain runs on Cloudflare. It runs no hands, so this
  note doesn't call it a host.
