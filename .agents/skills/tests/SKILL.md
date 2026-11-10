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
   - Keep `@demlik/tea/pbt` on a machine's real reducer from its real `init`
     ([every machine has laws](../../../docs/direction/every-machine-has-laws.md)).
   - For a new property, use `@effect/vitest`'s `it.prop` or `it.effect.prop` with an existing Schema,
     or its own Effect Arbitrary exported beside it; write fast-check data only where Effect has
     nothing or to push edge cases. Effect's own tools come first (owner, 2026-11-08), `effect/testing`
     (`TestClock`, `TestConsole`, `TestSchema`) included.
   - When moving a law onto a schema's Arbitrary, keep its old reach: set size and run counts at
     least as large as the old generator, and test the real limit, not the schema's cap.
   - A hand-picked example stays only as a pinned case of a named past bug, in fast-check's
     `examples`, with the bug named beside it. A law that is only examples is not done.
   - A fixed test needs one of [the four labels](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property)
     and the plan's reason beside the check: `vector:`, `format:`, `pinned:` or `scenario:`.
   - A shape check (an import ban, a naming rule) is a lint rule, not a test.
   - If secrets must stay out of records, URLs or spans, require `[secrets]` in the plan's Law
     cell and a property over generated flows. Generate made-up words, keys and passes,
     operation orders, refusals and failures. Inspect every named output, including encoded URL
     forms. Plant a leak into each output and see the property fail. A scenario may supplement
     the property, never replace it. Send a missing marker or flow law back to plan unsigned.
3. **See each new law fail for the right reason:** the product does not do it yet. A typo, a
   missing import or a type error in the test is your bug, not a red. Every older law stays green.
4. **Fix test-side type errors** the build's product edits cause (a `// @ts-expect-error <why>` on a
   case that is invalid on purpose, or a reshaped test that still proves the refusal). Keep every
   law and plant.
5. **Commit** with the step-commit skill. In a box use `--commit-only`; fetch signs the run.
6. **Report** each new law with `file:line` and how you saw it fail, anything
   in the plan you found wrong, and any red that is a sandbox limit.

## Go easy on the machine

The test config and typecheck.sh hold worker, home and typecheck limits.

- Run `pnpm lint` once. Step-commit checks staged formatting.
- A sandbox may refuse sockets (`EPERM`), file watches (`EMFILE`), `ps` or Electron. Say which law
  that hits, and do not count it as red or green.

## Never

- The builder's uncommitted edits stay exactly as they are.
- Read, print or copy a key file. Push.
- Write a law that cannot fail, or one whose plant you did not run.
