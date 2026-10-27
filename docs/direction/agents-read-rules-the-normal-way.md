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
- **Claude moved over in experiment 155.** The builder, the reviewer and the
  planner now pass `ownRules` (`packages/fabrika/src/agents/claude/rules.ts`):
  `settingSources: ["project"]` for the rule files, `projectConfigRoot` on an
  empty folder so the repository's settings, hooks, env and `.claude/` stay out,
  and a built-in plugin option so `AGENTS.md` loads too. Claude does not read
  `AGENTS.md` by default.

  ```ts
  const options = {...rest, ...ownRules({disableClaudeAiConnectors: true})};
  // = {settingSources: ["project"], projectConfigRoot: "/var/empty",
  //    settings: {disableClaudeAiConnectors: true, pluginConfigs: AGENTS_MD}}
  ```

  The sorter and the ACP builder stay on `settingSources: []`: the sorter has
  no rules to read, and the ACP adapter's older SDK was not tested.
  - **Wrong guess, kept:** this note first said `["project"]` brings in the
    repository's `.claude/settings.json` with the rules and that the two might
    not come apart. The first half was right: hooks, env and the
    `apiKeyHelper` came in. The second half was wrong: `projectConfigRoot`
    keeps them apart. The worry about plugins was also wrong: the project's
    plugin never loaded in a headless run.

## Why

- The old way came from a fix on 2026-10-18, after a real run where the builder
  never saw a repository's `CLAUDE.md`. It was never a direction note, and it
  is older than experiment 107.
- Pasting loses what the standard gives: rule files in subfolders, and the
  `@file` imports in `CLAUDE.md`. It also cuts a file at 40,000 characters.
- Runs since 2026-10-24 happen in a box ([programs run in a box](./programs-run-in-a-box.md)),
  so a hook a repository turns on is fenced by the box, not by turning loading off.

**Confidence: 85%.** The doubt was Claude: whether a repository's hooks and
plugins can be kept out while its rules come in. Experiment 155 measured it:
they can, with `projectConfigRoot`. What is left: one run per variant on one
small model, the AGENTS.md option rides on a built-in plugin that a later
Claude Code could rename, and a box with no `/var/empty` refuses to start.

## What this cannot tell us

- Whether agents follow rule files in subfolders better than pasted ones. No
  run has compared them.
