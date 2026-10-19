# @tea-fabrika/ui-verification

An add-on pack that holds each build. When a build changes what a user sees, it asks the owner yes or no, with before and after pictures. It is a stand-in: it names the pictures and takes none.

```ts
import pack, {uiProgram, visibleOf} from "@tea-fabrika/ui-verification";

pack.listens; // {built: "built"}: the core's builds come in here
pack.answers; // {cleared: "cleared", raise: "raise"}: both go back to the core
pack.holds;   // true: the core waits for this pack before it ships a build

visibleOf(["src/ui/inbox.ts", "web/page.tsx", "src/fold.ts", "docs/a.md"],
          [/\.(tsx|jsx|css|html)$/, /^src\/ui\//]);
// ["src/ui/inbox.ts", "web/page.tsx"]

// told built {plan, task: "t1", build: 1, changes: ["src/fold.ts"]}
//   -> cleared {plan, task: "t1", build: 1, by: "ui-verification"}
// told built {plan, task: "t2", build: 1, changes: ["src/ui/inbox.tsx"]}
//   -> raise {plan, task: "t2", build: 1, by: "ui-verification", question: "This changes what a user sees (...). Is this what should change?",
//             attachments: [before .png, after .png, a 10 second .webm]}
```

The owner's yes or no goes to the core, not to this pack. Whoever shows the question to the owner (`owner-desk`, or nobody) is not named here.

## Where it sits

- In `packs/`, the top layer of `layer-rules.json`. Nothing below it may import it.
- It imports `@tea-fabrika/tea-program` and `@tea-fabrika/wip` (the `Built`, `Cleared` and `Raise` shapes of the `asks` program, and the `Pack` type).
- The core imports nothing of it. The core finds it by name from config.
- The root `package.json` lists it, so `loadPacks` can find it from the repo root.
- A core with no `holds` flag cannot be held, and `misfit` refuses this pack for it.

## What's in it

All in `src/index.ts`. The `exports` map has `.` and `./*`.

- `default`: the `Pack`, with `holds: true`.
- `uiProgram`: the program `ui-verification`. Input `built`; outputs `cleared` and `raise`.
- `visibleOf(changes, patterns)`: the changed files a user sees. Pure.
- `Shots`: the service that makes a build's pictures. `fakeShots(folder)` names them under `folder` and takes none.
- `Seen`: the service that holds the patterns of paths a user sees.
- `BY`: `"ui-verification"`, the name it signs its answers with.

## Settings

Read from its own table in the repository's `fabrika.toml`:

```toml
packs = ["@tea-fabrika/owner-desk", "@tea-fabrika/ui-verification"]

[pack."@tea-fabrika/ui-verification"]
seen = ["\\.(tsx|jsx|css|html)$", "^src/ui/"]   # regular expressions; these when left out
shots = "shots"                                  # where the pictures would go; "shots" when left out
```

A pattern that is not a valid regular expression refuses the pack, and the core does not start.

Fabrika's tsh starts this pack when the `packs` line of `fabrika.toml` names it: `desk`, `desk-demo` and `answer` (see `wip/README.md`). It is handed the host's folder for it and does not use it: `shots` stays as given. `owner-desk`'s end-to-end test also wires it by hand.

## Commands

| What | Command |
|---|---|
| Typecheck this package | `pnpm --filter @tea-fabrika/ui-verification typecheck` |
| Test this package | `pnpm vitest run packs/ui-verification` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

## See also

- [`docs/direction/packs-are-programs.md`](../../docs/direction/packs-are-programs.md), "Example: a ui-verification pack": what it is for.
- [Experiment 89](../../experiments/89-owner-desk.md): why the core gained `holds`, and this pack asking through `owner-desk`.
- `wip/src/asks/program.ts`: the core's `built`, `cleared`, `raise` and `holds`.
