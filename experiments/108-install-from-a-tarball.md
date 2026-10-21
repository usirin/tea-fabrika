# 108. Install from a tarball

The question: can `@kampus/fabrika` be built, packed, and installed by a
stranger, outside this repo, with npm and with pnpm, and still do everything the
tutorials promise?

The owner's calls, taken as given:

- rslib (`@rslib/core` 1.0.3), bundleless, `.d.ts` emitted, ESM only.
- `"private": true` stays in the repo. Only the packed copy lifts it.
- Services and runs-anywhere code on the top level, platform Layers on subpaths.
- `effect` and `@demlik/tea` are peers. Miniflare, the Agent SDK, ACP and
  OpenTelemetry are optional peers.
- Node 26 and up. No LICENSE yet: that is the owner's call.

**Answer: yes, with one tarball, from both package managers.**

- `pnpm build`: 195 `.js` and 195 `.d.ts` from 196 source files. The one left
  out is `host/workers.d.ts`, a declaration file already.
- npm and pnpm installs: no peer warning. The only notes are about workerd's
  install script, which both block by default.
- The two-hosts tutorial: 20 orders, 20 brewed, 20 poured, host-a killed with
  `kill -9` after order 8. Twice: npm and pnpm.
- The agents tutorial: 8 of 8 lines with real haiku, host-a killed with
  `kill -9` while it asked for the third guest. Twice. $0.003 for the two;
  $0.008 with four earlier runs on older tarballs.
- `tsc --noEmit` with `skipLibCheck: false`: 0 errors on the tutorials (25 of our
  `.d.ts`), and 0 on all 137 export modules at once (168 of our `.d.ts`).
- The `tsh` bin answers `-c 'programs'` (17 lines). With a peer missing it
  prints one line naming what to install, with our ranges.
- A browser bundle of the top level, from the tarball: 257 modules, 0 Node
  modules, 0 Miniflare, Agent SDK, ACP, OpenTelemetry or platform-node. It read
  23 files from `dist/` and 0 `.ts`.
- No optional peer installed: the top level and `/memory` load; `/local` fails
  with one message line and one stack frame.
- In the repo: 2029 tests, the same as main. Typecheck and lint green, and
  `node docs/tutorials/two-hosts/ledger.ts` starts, all with no `dist/`.
- `npm pack` and `npm publish` refuse, with one line saying to use pnpm.

Confidence 85%. The doubts: the pipeline still reads repo paths when it runs
(below), and the optional peers' newest versions already fall outside our
ranges.

## Source in the repo, `dist/` when installed

The repo must keep running on `.ts` source with no build first. An install must
get `dist/`. pnpm's own split does both. In the repo, `exports` and `bin` name
the source; `publishConfig` names the build, and `pnpm pack` and `pnpm publish`
swap it in:

```json
"exports": {".": "./src/index.ts"},
"bin": {"tsh": "./bin/tsh"},
"publishConfig": {
	"exports": {".": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}},
	"bin": {"tsh": "./dist/tsh.js"}
}
```

Nothing in the repo is told anything: tsc, vitest and a plain `node file.ts`
all read the source, and none of them can reach `dist/`. The packed manifest
was read back: its `exports` and `bin` name `dist/`, and `publishConfig` is
gone.

npm ignores `publishConfig.exports`. An npm pack would ship the source names
over a tarball that holds only `dist/`, and every import would break. So npm is
refused, not warned: `prepack` and `prepublishOnly` run `pnpm-only.ts`, which
exits 1 unless `npm_config_user_agent` starts with `pnpm/`. Both were tried:

```
$ npm pack
@kampus/fabrika is packed and published with pnpm only (this is npm/11.2.0): pnpm swaps in publishConfig's dist/ exports, npm does not. Run pnpm pack or pnpm publish.
```

`npm publish --dry-run` stops on the same line, before it packs anything.

The first try was a custom export condition, `@kampus/source`, ahead of
`types` and `default` in one map, with tsc, vitest and node each told about it.
It worked, but a `node file.ts` without `-C @kampus/source` silently read a
stale or missing `dist/`. A doc line saying to add the flag is not protection,
so it was dropped for the split above.

## What the build had to change

- **rslib copied files it saw in `new URL(...)`.** rslib reads
  `new URL("./x", import.meta.url)` as an asset and copies `x` into
  `dist/static/`. Ours point at runtime files and folders. The rule is off in
  `rslib.config.ts`. `new Worker(new URL(...))` is still rewritten to `.js`.
- **Files named by their `.ts` name at runtime.** The local ledger starts
  `daemon.ts` and hands Miniflare `durable-object.ts` and `rules.ts`. From
  `dist/` those are `.js`. `host/beside.ts` names a file beside the module with
  the module's own extension.
- **Miniflare's types fail `skipLibCheck: false`.** 821 errors, all in
  Miniflare's own declarations, reached because `ledgerOptions` returned
  `MiniflareOptions`. Its return type is now inferred, so our declarations never
  name Miniflare's.
- **TypeScript 7 emits `any` for `satisfies`.** An arrow function whose body
  ends in `x satisfies T` came out as `=> any` in the `.d.ts`. Not used.
- **The bin needed every optional peer but Miniflare.** From the first tarball,
  `tsh` died with Node's `ERR_MODULE_NOT_FOUND` deep in an import. `src/tsh.ts`
  is the bin now. It looks for the seven packages first and prints one line:

```
tsh: fabrika's programs need @agentclientprotocol/sdk, ..., not installed. Install: npm install "@agentclientprotocol/sdk@^1.6.1" ...
```

The ranges are ours, read from the package's own `package.json`. A bare
`npm install @opentelemetry/resources` takes 3.0.0, outside our `^2.11.0`.

## The fresh projects

Each is a new folder outside the workspace: Node 26.12.0 pinned, the tarball,
the tutorials copied in, and a `tsconfig.json` with `skipLibCheck: false`.

| Project | Installed with the tarball | What ran |
|---|---|---|
| npm, tutorials | effect, tea, platform-node, miniflare, Agent SDK | install, tsc, both tutorials, browser bundle, bin |
| pnpm, tutorials | the same | the same |
| npm, every peer | the same plus ACP and the five OpenTelemetry packages | tsc over all 137 exports, bin |
| npm, no optional peer | effect, tea, platform-node | top level, `/memory`, `/local`, browser bundle, bin |
| pnpm, no optional peer | the same | the same |

The fault, `/local` with no Miniflare:

```
[01:55:18.970] ERROR (#2): LocalError: @kampus/fabrika/local runs the ledger in Miniflare, which is not installed: install miniflare (npm install miniflare)
    at catch (.../node_modules/@kampus/fabrika/dist/host/local.js:16:16)
```

That is the message and one frame: Effect's `runMain` prints the frames up to
its own. Not a Node stack trace from inside an import.

## What went wrong on the way

- `pnpm add` in the repo rewrote `pnpm-workspace.yaml` and dropped its
  comments. Reverted, and the catalog line added by hand.
- Outside the repo, Volta picked Node 22, and npm warned about `engines`. The
  fresh projects pin Node 26.
- This machine's pnpm config has `catalog-mode=prefer`, which broke `pnpm add`
  in a fresh project. Run with `--config.catalog-mode=manual`, a stranger's
  default.
- `npm install` of the five OpenTelemetry packages at their latest fails:
  `@opentelemetry/api` 1.10.0 against `sdk-trace-base` 2.12.0, which wants
  under 1.10. Not ours, but a stranger meets it. The ranges in `tsh`'s line
  install cleanly; that was run.
- rspack refused top-level `await` in `src/tsh.ts` until the file exported
  something.

## Found, not fixed

- **The pipeline reads repo paths at runtime.** `./guard.ts` and
  `./check-hook.ts` by their `.ts` names, and the repo's `runs/`, `fixtures/`
  and `experiments/results/`. `agents/acp/harness.ts` reads its adapters from a
  repo path and starts `./fake-agent.ts`. From a tarball these break. Another
  change is working in `pipeline/`, so it was left alone.
- **Peer ranges already behind.** ACP is at 2.0.0 and the OTLP exporter at
  0.300.0, both outside our ranges.
- **Two copies of platform-node.** It is a plain dependency, pinned at 4.0.0 by
  the catalog; the app had 4.0.5. Both load. A peer, or a `^` range, would make
  it one.
- **The pnpm check reads an environment variable.** Someone who sets
  `npm_config_user_agent=pnpm/...` by hand gets past it. That takes intent; a
  slip does not.

## Before it can be published

- A LICENSE. The owner picks it.
- `"private": true` lifted, and a version.
- The pipeline's runtime paths, above, or `./pipeline/*` left out of the
  exports.
- A changesets config and a release workflow, publishing with pnpm; npm
  trusted publishing.

## How to run it

```sh
pnpm typecheck && pnpm lint && pnpm test   # no build needed
node docs/tutorials/two-hosts/ledger.ts    # the source, no build needed
cd packages/fabrika && pnpm pack           # builds dist/; then lift "private" in an unpacked copy and pack it again
npm pack                                   # refused: pnpm only
# in a new folder outside the repo, Node 26:
npm install <tarball> effect @demlik/tea @effect/platform-node miniflare @anthropic-ai/claude-agent-sdk
node two-hosts/ledger.ts                   # the tutorials, copied in
```

## What this cannot tell us

- The registry was never used. A tarball install is close, not the same.
- One machine, macOS, Node 26.12.0, npm 11 and pnpm 10. No Linux, no Windows,
  no yarn, no Bun.
- The browser bundle was built, not run.
- Each tutorial ran twice from the final tarball, once per package manager.
- The pipeline was not run from the tarball.
