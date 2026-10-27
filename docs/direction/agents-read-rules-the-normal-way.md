# Agents read a repository's rules the normal way

Decided 2026-10-26 by the owner.

```ts
// A sketch. The builder starts in the working copy and its agent reads the
// rule files itself, the nearest AGENTS.md winning, as the standard says.
const built = yield* Agents.run({ prompt, folder: workingCopy, provider }); // loads ./AGENTS.md,
                                                                            // packages/x/AGENTS.md, ...
// The reviewer reads them the same way, and is also handed main's copy, marked as the
// rules the pull request is judged by. A pull request cannot loosen its own rules.
const rules = yield* readRules({ repo, at: "main" });      // today's Gather in stages/rules.ts
const verdict = yield* Agents.run({ prompt: reviewBrief(pr, rules), folder: prCopy, provider });
```

## What was decided

- **Every agent reads rule files itself, the way its maker ships it.** A file
  inside a subfolder is meant for agents working there, and the nearest one
  wins. That is the [AGENTS.md](https://agents.md/) standard, and Codex already
  does it (experiment 153).
- **The reviewer is also handed main's copy of the rules.** A pull request can
  change an `AGENTS.md`, so the rules it is judged by come from the base
  branch. GitHub reads `CODEOWNERS` from the base branch for the same reason.
- **Claude moves over in a small follow-up.** Today every Claude run passes
  `settingSources: []` and gets `CLAUDE.md` and `AGENTS.md` pasted in by code
  (`packages/pipeline/src/stages/rules.ts`). Claude's own loading of a project's
  rules (`settingSources: ["project"]`) also loads the repository's
  `.claude/settings.json`, which can turn on hooks and plugins. The follow-up
  first tests what that brings into our box.

## Why

- The old way came from a fix on 2026-10-18, after a real run where the builder
  never saw a repository's `CLAUDE.md`. It was never a direction note, and it
  is older than experiment 107.
- Pasting loses what the standard gives: rule files in subfolders, and the
  `@file` imports in `CLAUDE.md`. It also cuts a file at 40,000 characters.
- Runs since 2026-10-24 happen in a box ([programs run in a box](./programs-run-in-a-box.md)),
  so a hook a repository turns on is fenced by the box, not by turning loading off.

**Confidence: 80%.** The doubt is Claude: whether a repository's hooks and
plugins can be kept out while its rules come in. The follow-up's test settles
it. If they cannot be kept apart, Claude keeps today's pasted rules until they
can.

## What this cannot tell us

- Whether agents follow rule files in subfolders better than pasted ones. No
  run has compared them.
