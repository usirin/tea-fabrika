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
   - **Test through public entry points only:** an exported name another package or a client can
     call, a machine's real `init` and reducer, a protocol message, a command. If a law has to
     reach past them, either the behavior is not worth a law or the entry point is missing. Say
     which in your report and send it back to plan.
   - **Assert the behavior, never the wording or the number behind it.** No law checks prompt
     wording, log or status text, a version number or a tuning default: these change on purpose,
     and a law that breaks when they do is noise. Check what they cause, such as "a refused send
     is not retried", not "the message says refused". The one exception is a `format:` law, for
     text the code must write or read exactly.
   - **A bug fix gets a `pinned:` case only when the bug shows at a public entry point.**
   - **Extend an existing law before adding one.** A pinned case goes into the `examples` of the
     property that covers its class, and a new case of a rule goes into that rule's generator.
     Write a new law only when no law covers the class.

   These four come from how
   [tim-smart/asphodel briefs its agents](https://github.com/tim-smart/asphodel/blob/main/AGENTS.md)
   ("Writing tests").
3. **See each new law fail for the right reason:** the product does not do it yet. A typo, a
   missing import or a type error in the test is your bug, not a red. Every older law stays green.
4. **Fix test-side type errors** the build's product edits cause (a `// @ts-expect-error <why>` on a
   case that is invalid on purpose, or a reshaped test that still proves the refusal). Keep every
   law and plant.
5. **Commit** with the step-commit skill. In a box use `--commit-only`; fetch signs the run.
6. **Report** each new law with `file:line` and how you saw it fail, anything
   in the plan you found wrong, and any red that is a sandbox limit.

## Outside your task

Something wrong that your task does not cover is one finding row with proof, then keep going:
never a fix, a ticket or only a mention, and never a security hole.
[A finding](../../../field/README.md#a-finding) has the fields, the closed `rule` list and what
counts as proof.

Outside means no law in the approved plan covers it. Something wrong in the plan is not a
finding: it goes back to plan (step 6).
Put the row in your report as one JSON line, its `id` the date and a short slug. The lead saves it
unchanged as its own file in `field/findings/`.

## Go easy on the machine

The test config and typecheck.sh hold worker, home and typecheck limits.

- Run `pnpm lint` once. Step-commit checks staged formatting.
- A law never reads the person's home folder or app data, not even to guard against it. A law that
  breaks on one machine is fixed by removing what it leaned on, never by catching the error
  ([0052](../../../.decisions/0052-tests-never-depend-on-the-machine.md)).
- A sandbox may refuse sockets (`EPERM`), file watches (`EMFILE`), `ps` or Electron. Say which law
  that hits, and do not count it as red or green.

## Never

- The builder's uncommitted edits stay exactly as they are.
- Read, print or copy a key file. Push.
- Write a law that cannot fail, or one whose plant you did not run.
