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

## Steps

1. **Read** `AGENTS.md`, then the approved plan, then the decided notes it builds.
2. **Read every commit** since `origin/main`. The branch may be behind main: judge the change, and
   say if a merge of main would conflict.
3. **Check:**
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
   - No `build` commit touches a path in `exam-paths.json`. Check each commit's step note with
     `git notes --ref=fabrika show <sha>`.
   - Nothing private in added lines: no personal or account names, no machine paths, no keys.
   - Screenshots in the program's `docs/` folder when the plan asks for them, at its layouts.
   - Anything else the brief names for this round, such as the mutation step's added laws.
4. **Answer** with one verdict line first, `merge-ready` or `changes: <n>`. Then each finding as
   `file:line`, what is wrong, and why it matters, most serious first.

## Never

- Change, stage or commit a file. Run a command that writes to the branch.
- Give style nits. A finding is something that is wrong or that a decided note rules out.
- Approve a pull request on GitHub, or answer a question the machine put to a person.
