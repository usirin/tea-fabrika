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
- **Claude moved over in experiment 155.** The builder, the reviewer, the
  planner and the Claude adapter of the agent interface (experiment 156) now
  pass `ownRules` (`packages/fabrika/src/agents/claude/rules.ts`):
  `settingSources: ["project"]` for the rule files, `projectConfigRoot` on an
  empty folder so the repository's settings, hooks, env and `.claude/` stay out,
  and a built-in plugin option so `AGENTS.md` loads too. Claude does not read
  `AGENTS.md` by default.

  ```ts
  const options = {...rest, ...ownRules({disableClaudeAiConnectors: true})};
  // = {settingSources: ["project"], projectConfigRoot: "/var/empty",
  //    settings: {disableClaudeAiConnectors: true, pluginConfigs: AGENTS_MD}}
  ```

  The sorter, the ACP builder and the interface's `acp-claude` row stay on
  `settingSources: []`: the sorter has no rules to read, and the ACP
  adapter's older SDK (0.3.286) was not tested. The ACP paths keep pasting
  the rules into the prompt.
  - **Wrong guess, kept:** this note first said `["project"]` brings in the
    repository's `.claude/settings.json` with the rules and that the two might
    not come apart. The first half was right: hooks, env and the
    `apiKeyHelper` came in. The second half was wrong: `projectConfigRoot`
    keeps them apart. The worry about plugins was also wrong: the project's
    plugin never loaded in a headless run.
- **The repository's own settings stay out, even where only trusted people
  work in it.** The owner kept this on 2026-10-26, for two reasons:
  - Agents write the repository too. A hook added by mistake, or by text
    injected into an agent, would run on the next agent's run, outside the
    sandbox.
  - A repository's `.claude/` is set up for people's own sessions, not for
    agents a machine starts.
- **Only `ownRules` says where a Claude run's settings come from.**
  - `pnpm lint` refuses `settingSources` with a source in it, and any
    `projectConfigRoot`, anywhere but `rules.ts`
    (`oxlint-plugins/no-project-settings.ts`).
  - A stage's options for the Claude adapter cannot name them: its type
    refuses it.
  - A live run checks its options again, and the empty folder, before Claude
    Code starts. A refusal names the fix.
  - A run that loads the project's settings on purpose (an experiment that
    measures them, the old operator in `legacy/`) says why in a
    `oxlint-disable-next-line`.

  ```ts
  const options = {...rest, settingSources: ["project"]};
  //                        ^ pnpm lint: `settingSources` with a source in it can load the
  //                          project's hooks, env and apiKeyHelper (experiment 155). Load a
  //                          folder's rule files with `...ownRules(...)` ...
  ```
- **The repository's skills and subagents do not load this way.**
  `projectConfigRoot` moves all of `.claude/` to the empty folder, skills and
  agents too. Copying only `.claude/skills` and `.claude/agents` into an empty
  root of the run's own is a later option. It is untested.

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
small model, and the AGENTS.md option rides on a built-in plugin that a later
Claude Code could rename. A box with no `/var/empty` refused to start; the
box images now make it, and a live run checks it first and names the fix.

## What this cannot tell us

- Whether agents follow rule files in subfolders better than pasted ones. No
  run has compared them.
