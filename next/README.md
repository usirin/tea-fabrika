# next

The first running slice of the new design, beside today's code and importing none of it. Two
tiles, each a counter. The counter runs in the brain, loaded with Worker Loader. Every press is
saved on a new ledger. Any number of windows mirror one workspace, and each folds on its own.

```sh
node next/dev.ts       # prints the URL. Open it in two windows.
node next/e2e.ts       # drives all of it in headless Chromium, with real kill -9
```

Data stays in `runs/next/`, which git ignores. Delete that folder to start from zero. To try a lost
link, `kill -9` the workerd pid that the command prints: the windows say so, and come back.

```ts
// One press, top to bottom.
window   {type: "press", pid: "counter:1", m: {type: "plus"}}   // into the outbox, with saw and an id
gateway  window.msg, `by` stamped from the socket
process  mailbox.send -> ledger.append("counter:1/inbox", id, line)   // {pos: 42, rev: 412}
program  step(model, m) in its loaded isolate                         // {n: 41} -> {n: 42}
windows  view.patch {pid, rev: 42, patch: [{op: "replace", path: "/n", value: 42}], ledger: 412}
```

## The folders

Each layer imports only from below it, and `src/layers.test.ts` keeps that true.

| Folder | What it holds |
|---|---|
| `src/transport` | The JSON-RPC wire, the pipe's machine (hello, ping, backoff), one gateway per peer |
| `src/data` | The project object: one log with `append`, `read`, `wait`, numbered as D3 says |
| `src/coordination` | A mailbox over the log, and a process manager that only says `start` |
| `src/app` | The program contract, the process object, patches |
| `src/desktop` | The desk (layout in percent, focus, a process like any other) and the fold |
| `src/programs/counter` | The program and its React view |
| `src/window` | One tab: a tea machine and its React view |
| `src/brain.ts` | The Worker that wires the layers together |

## What is real

- Workers and objects in real workerd, through Miniflare, saved to disk.
- The counter and the desk load through Worker Loader, with no network, keyed by the hash of their code.
- A text ping and pong, answered without waking the gateway's code. A hung brain is noticed by the missing pong.
- Reconnect with backoff, an outbox with ids, and a resend saved once.
- A view is a whole copy at a revision, then JSON patches. Every window Msg carries `saw`.
- The layout stays in percent in the desk. Each window folds by its own size.

## What is left out on purpose

- Agents, the hands, tsh, packs and `fabrika.toml`.
- Signed hellos (T5). Who you are is the name your tab made up. The brain takes only its own
  origin and its own Host, on 127.0.0.1, and that is all the safety there is.
- Supervisors, links, monitors, dead letters (C2 to C5). A process only has `start`.
- Snapshots. A wake replays the inbox, so it gets slower as the inbox grows.
- A program's Cmds. With no hands, the counter and the desk have none.
- Limits and quotas, keys and prefix keys, more than one workspace on screen, moving tiles.

## What it cannot tell us

It runs on one laptop, with one person's load, and two small programs. It says nothing about many
projects, a long inbox, a large view, or a real network. The local host restarts a dead brain but
not a hung one: a hung brain shows as a lost link until someone kills it.
