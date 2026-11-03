# @kampus/ledger-server

One shared ledger on Cloudflare, for a team of people: fabrika's own ledger Worker and Durable
Object, with the shared door. A person logs in with their SSH key, checked against the keys
GitHub lists for their login. The founder invites the others by their GitHub login.

```ts
const config = decodeConfig({name: "acme-ledger", founder: "github:7"});
ledgerBindings({door: serverDoor(config)});
// { EXPIRY_GRACE_MS: "1000", DOOR: "shared", FOUNDER: "github:7", KEYS: "github" }
```

The deploy and the twin are built from those same two things: the Worker fabrika ships
(`LEDGER_ENTRY`) and these bindings. See
[`docs/direction/the-ledger-goes-to-cloudflare.md`](../../docs/direction/the-ledger-goes-to-cloudflare.md).

## Files

| File | What it holds |
|---|---|
| `src/config.ts` | `ServerConfig`: the Worker's name, its founder (`github:<id>`), and its origin if it sits behind its own domain. `serverDoor`: the shared door for it |
| `src/stack.ts` | `ledgerStack`: the Alchemy stack. One Worker, one Durable Object namespace, kept when the stack is destroyed |
| `alchemy.run.ts` | The stack Alchemy deploys, from `LEDGER_NAME`, `LEDGER_FOUNDER`, `LEDGER_ORIGIN` and an optional `LEDGER_GITHUB_TOKEN` |
| `src/twin.ts` | `startTwin`: the laptop's twin, the same Worker and bindings in Miniflare. A test hands it a fake GitHub |
| `src/twin-main.ts` | `pnpm twin --name <name> --founder github:<id> --persist <folder>`: the twin on port 8787, until Ctrl-C. It talks to the real GitHub |

## The twin

Run it, then connect a home to it:

```sh
pnpm --filter @kampus/ledger-server twin --name acme-ledger --founder github:7 --persist ~/.fabrika-twin
pnpm --filter @kampus/fabrika-app-old cli connect http://127.0.0.1:8787/acme --login alice --key ~/.ssh/id_ed25519
```

The twin is Miniflare, not `alchemy dev`. Two reasons:

- Only Miniflare's `outboundService` lets a test answer the Worker's GitHub calls with a fake.
- Alchemy reads its working folder once, at import, so one test process cannot run two stacks.

Both run the same Worker file with the same bindings, so what differs is the Cloudflare part
around it: the real network, real limits, a real deploy.

## Deploy

Not run yet. It waits for the owner. The command:

```sh
cd packages/ledger-server
LEDGER_NAME=acme-ledger LEDGER_FOUNDER=github:<your id> pnpm exec alchemy deploy --stage cloud
```

It makes one Worker named `acme-ledger` with one SQLite Durable Object namespace for the class
`Ledger`. Logs are off. The Durable Object is kept if the stack is destroyed. Alchemy keeps its
state in `.alchemy/` in this folder.

## What the twin cannot show

- How the real Cloudflare network, its limits and its cold starts behave.
- GitHub's real rate limits. Without `LEDGER_GITHUB_TOKEN`, GitHub allows 60 calls an hour.
- That a deploy works at all. Nothing here has been deployed.
