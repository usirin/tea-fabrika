---
name: plan
description: Write the plan for one tea-fabrika pull request, read-only, as the pipeline's plan step. Use when a brief says "use the plan skill for ticket N", or when you are the plan writer for a hand-run ticket.
---

# The plan step

You write one plan and nothing else: no code, no tests, no commits, no pull requests. Your final
message is the whole plan, in Markdown. The lead saves it and approves it, or sends it back.
Return it unsigned, including when reviewing or revising a plan. Only the lead session may fill
the blank approval line. Every agent may file tracker tickets, even during read-only repo work.
Filing a ticket does not claim it or start its build.

A brief names only the ticket: what it builds, which version (`next/` or today's), the notes and
rows to read, and an older plan to copy the shape of. This skill holds the rest.

## Steps

1. **Read first:** `AGENTS.md`, all of it. Then `docs/plan/README.md`, then what the brief names:
   the tier rows (`docs/plan/tier-1.md`, `tier-1-detail.md`), every direction note the row cites,
   and any note `rg -n "<row or word>" docs` finds.
2. **Read the code as built,** on main. Read the installed versions in `pnpm-lock.yaml` (Effect,
   `@demlik/tea`, vitest, any patch in `patches/`) and check every API against that version.
3. **Check what is settled** before you call anything open: `docs/direction/`, `experiments/`,
   `docs/plan/`, and the settled-search tool the brief names, if any. Read every hit.
4. **Lead with the known way.** How the makers do it (Elm and Erlang/OTP first, then Effect and the
   industry). Cite what you read; mark what you did not fetch.
5. **Write the plan** in the shape below.
6. **Check your own files table** against the exam list, so the lead's check finds nothing new:
   `python3 .agents/skills/step-commit/scripts/exam.py exam-paths.json <path>...`

## The shape

- A first line left blank, for the approval.
- Write `Plancheck-Version: 2` immediately after that blank line. Approval fills only the first
  line. Do not add a marker to a saved legacy plan.
- How others do it, with sources.
- The shape: types in code blocks, Effect Schema, `_tag` unions, names from settled notes.
- One value traced through, step by step.
- A table of properties a test checks, each with its plant (the break that must make it fail) and
  a `Generator` column: what its inputs are drawn from (fast-check, `@demlik/tea/pbt` or Effect's
  `Arbitrary`). Every law uses generated inputs unless it has one of these reason labels:
  `vector:` names fixed inputs from a specification; `format:` names the exact bytes of a fixed
  format; `pinned:` names a past bug's exact input, beside the property covering it; `scenario:`
  names one scripted outside run. Its internal logic still gets properties
  ([every law is a property](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property)).
  Ask of each law: lint, type or test? A shape check's cell says `lint` or `type`.
  Other cells say `fc.<name>` for a function exported by installed fast-check,
  `@demlik/tea/pbt.arbMsg`, `.arbRecordMsg`, `.arbMsgSequence` or `.arbGuidedSequence`, optionally
  followed by `: description`; or `Effect Arbitrary: Schema.name`. A label needs a reason with a
  letter or digit. Put arguments and custom-generator details after the colon.
- When secrets must stay out of records, URLs or spans, mark the Law cell with `[secrets]`.
  Require a property over generated flows. Generate made-up words, keys and passes, operation
  orders, refusals and failures. Inspect every named output, including encoded URL forms. Plant
  a leak into each named output. The marked row needs an `fc`, tea or Effect generated-input
  family. A separate scenario row may supplement it, but a fixed label, `lint` or `type` cannot
  replace the property. Ordinary keyboard laws keep the normal grammar.
- **The files table, with lines, and an owner step for every file:** `tests`, `build` or `lead`.
  Every path that matches a glob in `exam-paths.json` belongs to `tests`. A builder is never handed
  one. If the build needs an exam file changed, that change goes in the tests commit.
- Screenshots at five layouts when a window changes (`AGENTS.md`, "Shoot more than one layout").
- Say what fact is lost if it is not recorded now.
- Split a big plan into pull requests that each land whole, ordered by what the owner sees first.

## The open questions test

A question that only picks how the code does what a note already says is yours: decide it in one
line, and name the note. That includes an item a row calls "a walk" or "the owner approves" when a
decided note answers it. Before you put anything in open questions, ask: could the owner say no
without contradicting a decision already made? If not, it is not a question.

## Never

- Write a file. Run in a read-only sandbox, or act as if you were.
- Quote anything private: no names, no machine paths, no chat quotes. Cite only repo files.
- Leave a file without an owner step, or give `build` an exam path.

Plain short sentences, American English, no em dashes.

## Scripts

plancheck.sh checks the draft; only the lead session reads and approves the whole plan and amendments.
Draft and approved checks cover sections, questions, exam paths and the exact body bytes after
line two. The draft prints the digest. `--approved` checks the approval line against it.

`scripts/plancheck.sh --draft <plan.md>` requires a blank first line, `Plancheck-Version: 2` on
line two, and no unfenced line beginning `Approved by the lead agent,`. The lead session runs it
before approval. It checks the format, not who wrote it.

`scripts/plancheck.sh <plan.md>` keeps saved-plan behavior, including approved and legacy plans. It
checks owners in every plan. Version 2 also checks each laws table's generator grammar and requires
generated inputs on `[secrets]` rows. An unmarked plan prints `legacy plan: generator checks
skipped`; unknown, malformed or duplicate markers fail. Escaped pipes stay in their cells. Every
exam path in a files table's file/path cell counts, whatever words or punctuation surround it,
unless the cell names another package with a possessive (`Counter's package.json`); then only paths
with a `/` count. A possessive of this repository (`the repo's package.json`) is not another
package. Bare root paths in prose or other columns never decide the exit code. Apart from that
check, the `exam path named` listing is a total scan that reads no Markdown: it splits the whole
file, fences, link titles and comments included, into words and lists each one the exam list
matches, wherever it stands. A false listing is harmless; the lead checks each listed path is owned
by `tests`. The lead runs this before approving. Return the checked draft unsigned.

## Where code goes in `next/`

Anyone must be able to take `@kampus/libfabrika` alone and build a client that works exactly like
fabrika; fabrika is one such client (owner, 2026-11-08). So for every file the plan puts in
`next/apps/fabrika`, ask: would a from-scratch client have to write this again? If yes, it goes in
libfabrika, and the app only picks Layers and hands them in.
