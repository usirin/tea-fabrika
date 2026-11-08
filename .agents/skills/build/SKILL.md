---
name: build
description: Be the builder for one tea-fabrika ticket, the pipeline step that makes the test writer's red laws green in product code. Use when a brief says "use the build skill for ticket N", or when a review or the lead sends product fixes back to the build.
---

# The builder

You make the test writer's red laws green, in product code only, as the approved plan says. You
never touch a test or an exam path. No builder starts before an approved plan and tests that exist
([the steps](../../../docs/direction/next-is-a-pipeline-pre-run.md)).

A brief names the ticket, the plan's path, the branch, and what this round fixes. This skill holds
the rest.

## Steps

1. **Read** `AGENTS.md` (all of it), then the approved plan, then the decided notes it builds. Say
   which version you are in. In `next/`: Effect all the way, no Promises, an object class stays thin.
2. **Run the red laws** on a narrow path and read why each fails.
3. **Build** only the files the plan's files table gives `build`. Follow the plan and the decided
   notes, and nothing they leave undecided.
4. **If a test or an exam path must change, stop.** Name the file, the line and why, and answer
   `send` to tests. The step-commit script refuses a build commit that holds an exam path anyway.
5. **Run** one capped command, for the narrow check while you work and the final check:
   `nice -n 15 pnpm exec vitest run --changed origin/main --maxWorkers=3` (only tests that reach a
   changed file; a pull request's CI runs the same, the full suite runs on main after the merge,
   and `next/`'s own job runs all its tests). In a Codex box, drop `nice` and use
   `--maxWorkers=1`. Then one typecheck at the end.
   - When the change touches a file in `forceRerunTriggers` (`vitest.config.ts`: vitest's own,
     such as `package.json` and the vitest config, plus the lockfile, `pnpm-workspace.yaml`, a
     `tsconfig`, the lint and format settings, `oxlint-plugins/`, `layer-rules.json`, `fixtures/`
     and `.github/`), `--changed` selects the whole suite. Run it
     still capped, once, at the end, and never while another agent's full run or typecheck runs.
6. **Commit and sign** with the step-commit skill:
   `sh .agents/skills/step-commit/scripts/stepcommit.sh build <ticket> "T<ticket> build: <subject>" <paths...>`
7. **Report** in at most 6 lines: which laws went green, any still red and why, any file you needed
   but may not touch, and what the lead's own run must show (Electron, screenshots).

## Go easy on the machine

- Any run that starts the app, the brain or the stage sets its own temp `FABRIKA_HOME` first
  (`mktemp -d /tmp/fh.XXXX`, short, since a socket path has a 103-byte limit). Never the real
  `~/.fabrika`: a P12 hand run once wrote its stage files there.
- In a Codex box: `pnpm exec vitest run --maxWorkers=1 <narrow path>`. `nice` and `pgrep` are
  blocked there, so skip them.
- Elsewhere: `nice -n 15 pnpm exec vitest run --maxWorkers=3 <narrow path>`, and `nice -n 19` with
  `--maxWorkers=1` when two or more code agents run.
- `pnpm format`, then `pnpm lint`. One `pnpm typecheck` at the very end, never while another runs.
- Electron cannot start in a box. Reason from the code and say what the lead's rerun must show.

## Never

- Change a test, a fixture, a lint rule or any path in `exam-paths.json`.
- Switch a lint rule off to pass. A `// oxlint-disable-next-line <rule> -- <why>` is only for a line
  where the code is right and the rule does not fit.
- Leave a stub, a dead button or "(not yet)" in the product ("no rough first versions").
- Reset, rebase or amend. Read, print or copy a key file. Push.
