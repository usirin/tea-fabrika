# The cloud is one more host

**Proposed 2026-10-27 by the owner, for the next iteration.** Not built. The
first shared ledger ships as it is today
([the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)); this
note says what replaces its shape after that.

```ts
// A sketch. Every place fabrika runs is a host, and every host is the same kind of thing.
type Where = "laptop" | "cloudflare"; // where it runs; nothing else differs
const host = yield* Host.start({where, ledger}); // runs programs and jobs, keeps a ledger
// Two laptops and one Cloudflare host. They meet on the shared ledger the Cloudflare host keeps:
//   laptop A  ->  shared ledger  <-  laptop B
//                      ^
//                Cloudflare host (never sleeps, runs jobs too)
```

- **The leak today.** "The ledger server" (`packages/ledger-server`) is a
  special thing: laptops run hosts, and the cloud runs something else that
  only stores. Two kinds of place, two sets of rules.
- **The change:** there is one abstraction, the host
  ([tea-host](./tea-host.md), OTP's node). A laptop's host keeps a local
  ledger; the Cloudflare host keeps the shared one. The Cloudflare host runs
  programs and jobs in its own environment, like a laptop that never sleeps.
- **What stays:** the shared ledger is still the one meeting point. Hosts do
  not talk to each other directly. The door, the SSH-key login, invites and
  the move of a laptop's tickets carry over as they are.
- **What it reopens:** the host on Cloudflare was parked on 2026-10-25
  ([tea-host](./tea-host.md)). This brings it back, for the shape, not yet for
  running a person's agent there
  ([where a person's login lives](./agents-behind-one-service.md#where-a-persons-login-lives)).
- **Others:** Erlang/OTP nodes are all the same kind of process wherever they
  run; a node's place is configuration, not a different program.
- **Cost:** `packages/ledger-server` folds into the host's Cloudflare build,
  and the host's supervisor has to run inside a Durable Object. Not measured.
- **How sure: 70%.** The doubt: what a Durable Object host cannot do that a
  laptop host does (long processes, files, a terminal). Experiment 148's box
  is the first answer to read before this is designed.

## What it cannot tell us

- Nothing is built or measured. This note keeps the idea until the next
  iteration starts.
