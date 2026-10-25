# tea-host: OTP for tea programs

Decided 2026-10-19. A first `packages/tea-host` exists since experiment 98
(2026-10-20): the ledger, `serve`, `call`, `whereis`. Experiment 99 added
monitors, links and a `one_for_one` supervisor, with dead letters for a
message that crashes its program every time. Experiment 100 made it a tree:
`one_for_all`, `rest_for_one`, escalation one level up, child control,
opt-in restart backoff, and resending a dead letter.

## What was decided

- **No new architecture: we implement OTP.** A new package, `tea-host`, does
  in TypeScript what Erlang/OTP already does, with tea programs in place of
  processes. Where OTP has a word for a thing, we use that word. Elixir's
  additions on top (`Registry`, `DynamicSupervisor`, Phoenix PubSub) are fair
  game too, and are marked as Elixir's below.
- **The closest thing on Cloudflare is a Durable Object.** One at a time,
  addressed by a name, its own state: an actor, close to an Orleans grain
  (a virtual actor). workerd plays the node. What it lacks is OTP's links,
  monitors and supervisors, which tea-host adds.
- **A host is a running process that runs tea programs.** One machine can run
  several. A Cloudflare Durable Object can be one. It is OTP's node.
- **One host per project, decided 2026-10-25.** OTP's practices, not only
  its words: two separate systems on one machine are two nodes, each with its
  own database folder and cookie, and never one node. A node shares one VM,
  one database and one set of connections, and connections between nodes
  spread ([Erlang](https://www.erlang.org/doc/system/distributed.html)). So
  two projects open in the app are two hosts, each with its own tsh. See
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md).
- **Every host uses exactly one ledger, and config picks which:** a team's
  Durable Object, your own Cloudflare account's Durable Object (to share
  context between your own agents, wherever they run), or a local one. There
  is no extra journal per host; program runs log to that one ledger.
- **The ledger belongs to tea-host, not to fabrika.** A host gives its
  programs a `Ledger` service. fabrika is a suite of tea programs that use
  whatever ledger their host gives them. This moves `Ledger` out of
  [the ledger behind a service](./ledger-behind-a-service.md); `CodeHost`
  stays with fabrika.
- **tea stays small.** Everything here is built on tea and Effect, in
  tea-host. tea does not grow to fit it.
- **The first two tests, in order.** Test 1: three hosts share one ledger; a
  `counter` program gets 1,000 messages while its host is killed twice;
  another host takes it over and replays, and the count ends at exactly
  1,000. Test 2: an agent on one host asks an agent on a second host, run
  in a Docker container, a question and gets the answer, both hosts on one
  shared ledger. The container gives the second host its own files,
  processes and network, and the test repeats anywhere, CI included. A real
  second computer over the internet is a one-off check after it. The
  counter goes first because it proves no message is lost or doubled,
  cheaply and the same way every run; agent replies vary and cost money.
- **Agents on different computers can talk.** Each is a program on a host,
  so talking is a send to an address. "No ping-pong between the main
  stages" is a rule of fabrika's pipeline, not a limit of tea-host. For
  agents outside the system, check Google's A2A protocol before writing
  our own.

## The map

| OTP (or Elixir, where marked) | tea-host |
|---|---|
| node | host |
| process, `gen_server` | tea program (`update` is `handle_cast`) |
| mailbox | a program's inputs |
| `via` names; Elixir's `Registry` | an address per program, `get(id)` |
| `supervisor`; Elixir's `DynamicSupervisor` | restarts a program that crashed (experiments 99, 100) |
| links, monitors | a program hears when another one dies (experiment 99) |
| messages between nodes | programs on different hosts telling each other (`cast`, `call`; experiments 95, 98) |
| remote shell (`erl -remsh`) | tsh, attached to a host (lean) |
| `observer` | Tuval, attached to one or more hosts (lean) |
| Elixir's Phoenix PubSub | the ledger's tail |
| Mnesia | the ledger, with one referee instead of copies |

## Still open

- **tsh and Tuval are clients, not hosts.** That is the lean (75% for Tuval,
  60% for tsh): both attach to hosts and run no programs of their own. The
  host table in [tea-program](./tea-program.md) still names them as hosts and
  changes when this is confirmed.
  *Half answered 2026-10-22 by [the GUI note](./the-gui-is-a-local-web-page-first.md):
  the gui page is a client, a view over one WebSocket, and the fabrika app's
  Node process is the host it talks to. Whether a page can attach to more
  than one host, and tsh, are still open.*
  *Changed 2026-10-24 by [Electron first](./the-gui-is-electron-first.md): the
  host runs in Electron's main process, and the window talks to it over one
  MessagePort, not a WebSocket.*
  *Changed again 2026-10-25: the fabrika app is a client. Its host runs as a
  process of its own, as the tmux server does, and the app attaches to it over
  a socket file
  ([the GUI note](./the-gui-is-electron-first.md#decided-2026-10-25-later-tuval-and-tmux-decide-the-host-runs-apart)).
  More than one host, and tsh in a plain terminal, are still open.*
- **Where a host's config lives.** Not in `tsh.toml`, which is tsh's alone.
  One part is settled (experiment 107): which ledger fabrika's tsh opens is
  the repository's pick, `[ledger] at` in its
  [fabrika.toml](./one-fabrika-toml-per-repo.md) (`local`, the Durable
  Object, when left out), printed at start, so two machines on one
  repository pick alike. A host's own file, for what is not the
  repository's, is still open.
- **How a message travels.** The lean for test 1 is that a send is a ledger
  append with a message id: replay and takeover come for free, and hosts
  behind home routers need no tunnel. If a deployed ledger's p99 append
  is over about 50 ms, a direct host-to-host path comes next, and it still
  records the message.
- **Settled since:** the ledger is one Durable Object everywhere, run
  locally in Miniflare (experiment 93); the local host restarts it when its
  memory passes a cap. See [the sync engine note](./a-local-first-sync-engine.md).

## What would change it

A real need that OTP's model does not cover, shown by a run. Then we name
the gap and look for the industry's answer before writing our own.
