---
name: tests
description: Be the test writer for one tea-fabrika ticket, the pipeline step that writes the laws before the build. Use when a brief says "use the tests skill for ticket N", or when a builder or review sends work back to the tests step.
---

# The test writer

You write the laws an approved plan asks for, each with its plant, and see each new one fail for
the reason the plan gives. The builder then makes them green and may not touch them
([nobody writes their own exam](../../../docs/direction/nobody-writes-their-own-exam.md)).

A brief names the ticket, the plan's path, the branch, and what this round is for. This skill holds
the rest.

## Steps

1. **Read** `AGENTS.md` (all of it), then the approved plan the brief names, then the code and the
   rows it points to. Say which version you are in: `next/` or today's.
2. **Write each law with its plant.** Every law uses generated inputs on the real code unless it
   has one of the four reason labels, not only laws on a machine
   ([every law is a property](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property),
   [property tests](../../../docs/direction/property-tests-not-our-own-search.md)):
   - On a machine: its real reducer from its real `init`, with `@demlik/tea/pbt`
     ([every machine has laws](../../../docs/direction/every-machine-has-laws.md)).
   - On anything else, Effect's own tools first (owner, 2026-11-08): `Arbitrary.schema(S)`
     for data when a schema exists, `@effect/vitest`'s
     `it.prop` and `it.effect.prop` (they take schemas as inputs), and `effect/testing`
     (`TestClock`, `TestConsole`, `TestSchema`). Hand-written `fast-check`
     (`fc.assert(fc.property(...))`) only where Effect has nothing.
   - A hand-picked example stays only as a pinned case of a named past bug, in fast-check's
     `examples`, with the bug named beside it. A law that is only examples is not done.
   - Four kinds of law may be a fixed test, and the test's name starts with its label: `vector:` (a
     fixed input and answer from a spec), `format:` (a fixed format written or read exactly),
     `pinned:` (a named past bug), `scenario:` (one scripted run against the outside world, such
     as a real Electron window or a real `git push`). Anything else is a property
     ([the four labels](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property)).
   - Keep the plan's reason for each label beside the check. The reviewer checks that each law's
     property or label is present and fits.
   - A shape check (an import ban, a naming rule) is a lint rule, not a test.
   - If secrets must stay out of records, URLs or spans, require `[secrets]` in the plan's Law
     cell and a property over generated flows. Generate made-up words, keys and passes,
     operation orders, refusals and failures. Inspect every named output, including encoded URL
     forms. Plant a leak into each output and see the property fail. A scenario may supplement
     the property, never replace it. Send a missing marker or flow law back to plan unsigned.
3. **Do the exam work yourself.** Every exam path the plan gives `tests` is yours: lint rules,
   `exam-paths.json` rows, fixtures, an e2e runner. A builder is never handed one.
4. **See each new law fail for the right reason:** the product does not do it yet. A typo, a
   missing import or a type error in the test is your bug, not a red. Every older law stays green.
5. **Fix test-side type errors** the build's product edits cause (a `// @ts-expect-error <why>` on a
   case that is invalid on purpose, or a reshaped test that still proves the refusal). Keep every
   law and plant.
6. **Commit and sign** with the step-commit skill:
   `sh .agents/skills/step-commit/scripts/stepcommit.sh tests <ticket> "T<ticket> tests: <subject>" <paths...>`
7. **Report** in at most 6 lines: each new law with `file:line` and how you saw it fail, anything
   in the plan you found wrong, and any red that is a sandbox limit.

## Go easy on the machine

- Any run that starts the app, the brain or the stage sets its own temp `FABRIKA_HOME` first
  (`mktemp -d /tmp/fh.XXXX`, short, since a socket path has a 103-byte limit). Never the real
  `~/.fabrika`: a P12 hand run once wrote its stage files there.
- In a Codex box: `pnpm exec vitest run --maxWorkers=1 <narrow path>`. `nice` and `pgrep` are
  blocked there, so skip them.
- Elsewhere: `nice -n 15 pnpm exec vitest run --maxWorkers=3 <narrow path>`, and `nice -n 19` with
  `--maxWorkers=1` when two or more code agents run.
- `pnpm format` before each commit, `pnpm lint` once. One `pnpm typecheck` at the end only if the
  brief allows it, and never while another runs (`pgrep -x tsgo`).
- A sandbox may refuse sockets (`EPERM`), file watches (`EMFILE`), `ps` or Electron. Say which law
  that hits, and do not count it as red or green.

## Never

- Change product code. The builder's uncommitted edits stay exactly as they are; stage only yours.
- Reset, rebase or amend. Taking over another step's work is a new commit on top.
- Read, print or copy a key file. Push.
- Write a law that cannot fail, or one whose plant you did not run.
