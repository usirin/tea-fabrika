---
name: review
description: Do the one review of a tea-fabrika ticket's whole diff, read-only, against its approved plan and decided notes. Use when a brief says "use the review skill for ticket N", after the tests, build and mutation steps.
---

# The one review

You read every commit since `origin/main` and judge the change against the approved plan and the
decided notes it builds. You change nothing and commit nothing. Your verdict is what lets the lead
merge ([how a change lands](../../../docs/plan/README.md#how-a-change-lands)).

A brief names the ticket, the plan's path, the branch, and anything this round must look at. This
skill holds the rest.

Never print npm, pnpm or env settings. The runner strips secret settings and redacts saved output.

## Steps

1. **Read** `AGENTS.md`, then the approved plan, then the decided notes it builds.
2. **Read every commit** since `origin/main`. The branch may be behind main: judge the change, and
   say if a merge of main would conflict.
3. **Check:**
   - Sweep, do not sample. For each law in the plan's table, list every way in: each public call,
     each cut point, and each saved or binding state. Check each one.
   - A finding names its class and every case of it.
   - A law written as examples over a class the plan names is a defect when a found case escapes
     those examples.
   - On a re-review, read every line the last fixes changed and what calls them first. Then finish
     the remaining checks.
   - Read every decided note the PR builds, following the plan's references and the change itself.
   - Block only on a broken decision in docs/direction or AGENTS.md, lost data, or a broken law.
     Each blocker cites that source and shows the missed case.
   - It does what the plan and the notes' decided parts say, and nothing they leave undecided.
   - "No rough first versions": no stub, dead button or "(not yet)".
   - Names follow `AGENTS.md` for its version (`_tag`, no `xOf`, "run" means an agent run in `next/`).
   - Every new law is a property test over generated inputs (fast-check, `@demlik/tea/pbt` or
     Effect's `Arbitrary`). A new law that is an example test with no generator is a defect. A
     pinned example is fine only inside a property's `examples`, naming the past bug it pins
     ([every law is a property](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property)).
     A fixed test is fine only when its name starts with one of four labels and it is that kind:
     `vector:`, `format:`, `pinned:` or `scenario:`. A hand-picked example checking a general rule,
     labeled or not, is a defect. Check that the property or label is present and fits, against the
     named spec, format, bug or run. Do not reopen each test's merits.
   - Each law catches its plant. Plant a break yourself where a law looks weak, in your head or in a
     scratch copy, never in the branch.
   - A law moved onto a schema's Arbitrary keeps its old reach.
   - If secrets must stay out of records, URLs or spans, the plan's Law cell has `[secrets]` and
     the law generates flows: made-up words, keys and passes, operation orders, refusals and
     failures. Check every named output, including encoded URL forms, and a leak planted in each.
     A scenario only supplements the property. Report a missing marker or flow law as a defect.
   - Screenshots in the program's `docs/` folder when the plan asks for them, at its layouts.
   - Anything else the brief names for this round, such as the mutation step's added laws.
4. **Answer.** Start with merge-ready; tickets: <m> or changes: <n>; tickets: <m>.
   n counts blocking classes. Each class lists every affected case. m counts distinct confirmed
   tracker tickets linked in this answer.
   Give every finding in that answer, grouped by class, most serious first.
   Name each checked decided note and say where the change follows or breaks it.
   Each blocker gives `file:line`, its source and the missed case. A demonstrated gap in a named
   class checks the law; it does not reopen every test's merits.

   Other actionable findings become tracker tickets. Use tracker_query to find an existing
   ticket, or tracker_file with value: {title, body, from: {_tag: "pr", url, step: "review"}}.
   Record the returned ID.
   Link each confirmed ticket in the answer. Filing claims no ticket and starts no build.
   If filing fails, include the exact pending payload for lead to retry. Do not count it as filed
   or start another review round for it.

## Never

- Change, stage or commit a file. Run a command that writes to the branch.
- Give style nits. A finding is something that is wrong or that a decided note rules out.
