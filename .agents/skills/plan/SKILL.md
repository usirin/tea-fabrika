---
name: plan
description: Write the plan for one tea-fabrika pull request, read-only, as the pipeline's plan step. Use when a brief says "use the plan skill for ticket N", or when you are the plan writer for a hand-run ticket.
---

# The plan step

Your final message is the whole plan, in Markdown. The lead saves it and approves it, or sends it back.
Return it unsigned, including when reviewing or revising a plan. Only the lead session may fill
the blank approval line.

## Steps

1. **Read first:** `AGENTS.md`, all of it. Then `docs/plan/README.md`, then what the brief names:
   the tier rows (`docs/plan/tier-1.md`, `tier-1-detail.md`), every direction note the row cites,
   and any note `rg -n "<row or word>" docs` finds.
2. **Read the code as built,** on main. Read the installed versions in `pnpm-lock.yaml` (Effect,
   `@demlik/tea`, vitest, any patch in `patches/`) and check every API against that version.
   Before you propose a patch or change to a package (tea, demlik, Manti, Effect, Alchemy), read
   its decisions, patterns and source, and name its answer or say you found none
   ([0054](../../../.decisions/0054-read-upstream-before-patching-it.md)).
3. **Check what is settled** before you call anything open: `docs/direction/`, `experiments/`,
   `docs/plan/`, and the settled-search tool the brief names, if any. Read every hit.
4. **Lead with the known way.** How the makers do it (Elm and Erlang/OTP first, then Effect and the
   industry). Cite what you read; mark what you did not fetch.
5. **Write the plan** in the shape below.

## The shape

- `plancheck.sh --draft` checks the plan's format.
- How others do it, with sources.
- The shape: types in code blocks, Effect Schema, `_tag` unions, names from settled notes.
- One value traced through, step by step.
- Laws use [generated inputs or a reason label](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property).
  Ask of each law: lint, type or test? A shape check's cell says `lint` or `type`.
- When secrets must stay out of records, URLs or spans, use `[secrets]` and generated flows.
  Inspect every named output, including encoded URLs, and plant a leak into each.
- `plancheck.sh` checks file owners and keeps exam paths with `tests`.
- When the plan changes a skill (owner, 2026-11-08), a rule code checks or could check becomes a
  check and leaves the prose. Only judgment stays in prose.
- Screenshots at five layouts when a window changes (`AGENTS.md`, "Shoot more than one layout").
- Say what fact is lost if it is not recorded now.
- Split a big plan into pull requests that each land whole, ordered by what the owner sees first.

## The open questions test

A question that only picks how the code does what a note already says is yours: decide it in one
line, and name the note. That includes an item a row calls "a walk" or "the owner approves" when a
decided note answers it. Before you put anything in open questions, ask: could the owner say no
without contradicting a decision already made? If not, it is not a question.

## Outside your task

Something wrong that your task does not cover is one finding row with proof, then keep going:
never a fix, a ticket or only a mention, and never a security hole.
[A finding](../../../field/README.md#a-finding) has the fields, the closed `rule` list and what
counts as proof.

Outside means the ticket does not ask for it and the plan does not need it. What the plan needs
goes in the plan.
Put the row in a last section of the plan, `## Findings`, as one JSON line in a fence. Its `id` is
the date and a short slug. The lead saves it unchanged as its own file in `field/findings/`.

## Never

- Quote anything private. Cite only repo files.

Plain short sentences, American English.

## Scripts

plancheck.sh checks the draft; only the lead session reads and approves the whole plan and amendments.
leakgrep.sh checks added text; private words stay outside the repo.

Draft and approved checks cover sections, questions, exam paths and the exact body bytes after
line two. The draft prints the digest. `--approved` checks the approval line against it.
The draft check checks the handoff format. It cannot prove session identity, because the step agents
and the lead share shell access. Do not add a marker, key or readable file as proof.

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
