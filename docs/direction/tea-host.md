# tea-host: OTP for tea programs

Decided 2026-10-19. Nothing is built yet.

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

## The map

| OTP (or Elixir, where marked) | tea-host |
|---|---|
| node | host |
| process, `gen_server` | tea program (`update` is `handle_cast`) |
| mailbox | a program's inputs |
| `via` names; Elixir's `Registry` | an address per program, `get(id)` |
| `supervisor`; Elixir's `DynamicSupervisor` | restarts a program that crashed (to build) |
| links, monitors | a program hears when another one dies (to build) |
| messages between nodes | programs on different hosts telling each other (to build) |
| remote shell (`erl -remsh`) | tsh, attached to a host (lean) |
| `observer` | Tuval, attached to one or more hosts (lean) |
| Elixir's Phoenix PubSub | the ledger's tail |
| Mnesia | the ledger, with one referee instead of copies |

## Still open

- **tsh and Tuval are clients, not hosts.** That is the lean (75% for Tuval,
  60% for tsh): both attach to hosts and run no programs of their own. The
  host table in [tea-program](./tea-program.md) still names them as hosts and
  changes when this is confirmed.
- **Where a host's config lives.** Not in `tsh.toml`, which is tsh's alone.
- **The first slice.** The supervisor is the biggest missing piece. Whether
  the ledger can be one Durable Object everywhere, run locally in Miniflare,
  is experiment 93.

## What would change it

A real need that OTP's model does not cover, shown by a run. Then we name
the gap and look for the industry's answer before writing our own.
