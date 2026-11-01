# Brain, hands, window, agent

**Decided 2026-10-31.** This note is about the new version: `next/` and
[the five layers](./a-local-first-sync-engine.md#decided-2026-10-30-and-2026-10-31-five-layers-central-first).
The word "peer" is gone, and so is "node" as a word for a machine or a
participant. Three things dial the brain: **hands**, a **window** and an
**agent**. `client` means any of them, and only when we talk about the door's
protocol. `host` means a computer.

```ts
// A sketch. One Mac, one VM, one brain.
//   host    a computer, like the Mac or the VM
//   brain   runs programs and keeps their state
//
// Three kinds of client dial the brain. Each has its own gateway and its own key.
//   hands   run jobs from the queue, on one host
//   window  draws, and sends a person's keys: a browser tab or an Electron window
//   agent   comes in through the bridge
//
// What each one says in its hello. The `has` list decides who gets a job.
{"key": "ed25519:mac...", "has": ["git", "files", "agents"]} // the Mac's hands
{"key": "ed25519:w1...", "has": []}                          // a window: the queue never offers it a job
```

## The words

Keep `client` boring. "The client dials." "One gateway per client." "One key per
client." When one kind is meant, name that kind.

| Word | Means | Say it like |
|---|---|---|
| hands | what runs jobs from the queue on one computer | "the Mac's hands took c-41" |
| window | what draws and sends a person's keys | "two windows show build:7" |
| agent | an agent, through the bridge | "the agent posts a fact" |
| client | any of the three, at the door | "the client signs its hello" |
| host | a computer | "hands run on a host" |

A ledger entry's `said` is "the writer's own clock".

## Windows are not hands

They do different jobs, and they fail differently.

```ts
// A sketch. Ticket #7.
// Hands: one takes each job, with a lease.
//   the Mac's hands claim c-41 and crash; the lease runs out; the VM's hands take c-41
// Windows: all of them mirror one view.
//   w1 and w2 show build:7; w1 dies; w2 still shows it, and nothing is lost
```

Temporal splits it the same way:
[Workers run tasks, Clients start and query](https://docs.temporal.io/develop/typescript/client/temporal-client).

## What stops a tab from getting a job

Not the names. The names are for talking and reading clearly. The protection is
the hello's `has` list. A window says it has little or nothing, so the queue
never offers it a job. A Cmd that `needs` git goes only to a client that says it
has git.

## The other answer we weighed

**A window is a set of hands with a small `has`.** This is the strongest
alternative, because every client already speaks the same wire and `has` already
does the protecting. One word would cover both, and no code would need to tell
them apart at the door.

We did not pick it because the jobs differ. One set of hands takes a job with a
lease. All windows mirror one view. Calling both "hands" makes people ask which
window holds a lease, and no window ever does.

## Why not the other words

- **Not "peer".** Too vague: it says nothing about what the thing does. It also
  sounds like an equal you talk to directly, and these never do. Every one dials
  the brain and meets the others through it (T1 and T2 in the five layers).
- **Not "node".** In Erlang a node is a running machine, and that word stays when
  we name OTP. As a word of ours it says nothing about what the thing does.
- **Not "host" for all of them.** A Mac with three tabs would be four hosts. And
  the brain, which really does host programs, would be the one thing not called
  a host. [RFC 1122](https://www.rfc-editor.org/rfc/rfc1122.txt) means an end
  computer by the word, and so do we.

## What it costs

- One note moved and about 70 lines reworded across the direction notes and
  `AGENTS.md`. No code changed.
- A search still finds "peer" in 25 files in `experiments/`. Those are records of
  their time, so they keep it.
- `host` still means something else in today's version: a running process that
  hosts programs. Check the path before you trust the word.

**How sure:** 70%. Two doubts:

- A window has a few hand-like jobs, such as opening a link or copying to the
  clipboard. If that list grows, the split needs another look.
- Since every client speaks the same wire, the split lives in words and not in
  the protocol. The first `next/` code that has to treat windows and hands
  differently, or that never does, would settle it.

## What it cannot tell us

- Whether the words stay clear once code uses them. No code in `next/` uses them
  yet.
- How well an agent fits beside the other two. Hands and windows have a written
  place in the transport layer. An agent's trip through the bridge has less
  written down.
- How long a window's `has` list really gets. Nobody has built one.
