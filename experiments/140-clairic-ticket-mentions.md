# 140. Can Clairic list what a ticket names, for the plan agent?

The question: a study of our lane found the biggest waste is each fresh agent
re-reading the same code. A cheap, exact list of what a ticket names could
shorten the plan agent's search. Cloudflare's new extraction model, Clairic,
returns only exact pieces of its input. Can it pull out the code names, files
and error messages a ticket mentions, and does it beat the code we already
have, `mentionsOf` in `legacy/src/facts.ts`?

**Answer: no. Clairic found the same files as our code, and added a lot of
noise. On the six tickets of experiment 86b, both reached 13 of the 36 files
the planner cited. Clairic's one extra file came from the word "span", which
is not a code name. Only 52% of Clairic's items were code the ticket meant
(68 of 130); `mentionsOf` was 97% (35 of 36). Clairic did catch two folder
paths that `mentionsOf` misses, and those folders hold 11 of the cited files.
That is a gap in our regex, and one regex change in our code would close it.
Clairic is fast (185 ms median), costs almost nothing ($0.0016 for 18 calls),
gave the same answer on every run, and every span was exact. Its
confidence is one number for a whole list, so it cannot flag a weak item.
Confidence 80%.**

```ts
// The whole idea, as the script runs it.
const text = `${ticket.title}\n\n${ticket.report}`;           // what 86b's planner read
const A = mentionsOf(text);                                  // our code: backticks and paths
const B = await clairic(text, {code_names, file_paths, error_messages}); // three list fields
const C = union(A, B);
for (const arm of [A, B, C]) {
	const pack = await facts(baseCommit).gather(arm);           // the same facts pack 86b built
	const files = filesIn(factsBrief(pack)) ∪ pathsNamed(arm);  // what the planner is handed
	recall(files, planPointers(ticket));                        // files the 86b plan cited
	recall(files, prChangedFiles(ticket));                      // files the fix PR changed
	handLabel(arm.items);                                       // code, prose, or a cut piece
}
```

## Who did what

- **This repo's code:** `mentionsOf`, the facts pack (`localFacts` and
  `factsBrief` from `legacy/src/`, code-graph off), the published names list
  (`userNames`), and all scoring. Script: `140-clairic-ticket-mentions.ts`.
- **Clairic:** one call a ticket, three runs, three list fields. It only
  extracted. It never saw the code.
- **No agent ran.** No Jev call. Nothing was written to GitHub. demlik was
  read through a fresh clone, under the ignored `runs/`.
- **Clairic is a preview model, with no warranty.** These answers may not
  hold for a later version.

## How it was done

- **The tickets:** the six kamp-us/demlik tickets of experiment 86b: 367,
  393, 490, 504, 565, 579. Each was read as 86b's planner read it: the title,
  then the report as filed (`replay/issues/<n>.json`).
- **The code:** each fix PR's base commit, checked out from a clone.
- **Arm A, code:** `mentionsOf` on the text, as 86b did.
- **Arm B, Clairic:** one call with three `list` fields of `text` items.
  Each `code_names` and `file_paths` item went through the same rules
  `mentionsOf` uses on a backticked span, so `compile()` became `compile`. An
  item those rules dropped was kept as a folder when it was slash-separated
  words.
- **Arm C:** both lists together.
- **What each arm hands the planner:** the facts pack for its list, built the
  same way for all three. The files are every file the brief names, plus
  every file a found path is, or is the tail of. A folder adds no file.
- **The fields,** written once before any answer and kept fixed:

  | field | instructions |
  |---|---|
  | `code_names` | Every name of code the ticket mentions: functions, methods, types, classes, variables, constants, config keys, CLI flags and package names. Write each exactly as in the text, one per item. Not file paths and not plain English words. |
  | `file_paths` | Every file or folder path the ticket mentions, such as src/a/b.ts or packages/x/README.md, exactly as written. Not URLs and not code names. |
  | `error_messages` | Every error message, failing assertion or compiler or test output the ticket quotes, exactly as written. |

- **Two truths:**
  - The files the 86b plan's `pointers` cite that exist at the base: 36 in
    all. This is what the planner found it needed. The `.changeset/` folder
    on 367 and an npm package's method were left out.
  - The files the fix PR changed that exist at the base: 20 in all. The 8
    new files (changesets, two new tests) were left out. No ticket could name
    those.
- **Precision, two ways:**
  - By hand: one reader labelled every item `code` (a name, path, flag,
    command, package, test name or quoted output the ticket writes as code),
    `prose` (an everyday word), or `cut` (a piece cut from something longer).
    The labels are in the script.
  - By machine: the item is a path or folder at the base, a declared name,
    or a name in the published docs.
- **Runs:** first 1 ticket, then the 6, then two more runs of all 6. 18
  calls.

## The numbers

Recall and precision over all six tickets. "Plan" means the 36 files the plan
cited; "PR" means the 20 files the fix changed.

| arm | plan files reached | PR files reached | items | code, by hand | real at the base | not in the text | under a folder it named |
|---|---|---|---|---|---|---|---|
| A, `mentionsOf` | 13 (36%) | 5 (25%) | 36 | 35 (97%) | 30 (83%) | 0 | 0 |
| B, Clairic | 13 (36%) | 6 (30%) | 130 | 68 (52%) | 71 (55%) | 0 | +15 plan, +10 PR |
| C, both | 14 (39%) | 6 (30%) | 136 | 73 (54%) | 76 (56%) | 0 | +15 plan, +10 PR |

- **Per ticket, the files reached were the same in A and B on 4 of 6.**
  - On 367, Clairic reached `otel/index.ts` through the item `span`, which
    is an everyday word in the title. It is the right file by luck.
  - On 393, `mentionsOf` reached `config.ts` through the backticked `lib`.
    Clairic did not list `lib`.
- **Clairic's noise:** 45 prose items and 17 cut pieces. Cuts include
  `scoreCo` (from `scoreCoChange`), `Bin` (from a company name), `dec`,
  `packages/tea/docs/how` and `<`. Every one is an exact piece of the input.
  The span rule stops made-up text. It does not stop a cut word.
- **A real-at-base check would not clean it.** 22 of Clairic's 62 noise items
  exist at the base: `main`, `open`, `span`, `name` and `regex` are
  declared somewhere; `how`, `per` and `RPC` are words in the published docs.
- **What Clairic caught that `mentionsOf` did not:**
  - Two bare folder paths, `packages/code-graph/src/boundaries/` on 393 and
    565. `mentionsOf` misses a folder path outside backticks; checked by hand
    on that line. On 393 the folder holds 5 files, all cited by the plan. On
    565 it holds 58 files, 6 of them cited. This is the 15 and 10 in the
    last column. A third folder, `packages/code-graph` on 504, holds 311
    files and is too big to help.
  - CLI flags and commands: `--boundaries`, `--ci`, `--layers`,
    `pnpm test`. `mentionsOf` drops them on purpose (`asName` takes
    identifiers only). They reach no file.
  - Dotted calls: `Scope.make()`, `Exit.void`. `mentionsOf` drops a dotted
    name. `Scope` and `Exit` reached the same files anyway.
- **The ceiling is low for both.** About two thirds of the files the planner
  cited are not named in the ticket at all. On 565 the ticket names a folder
  and the README, and the plan cited 10 files. No list extracted from the
  text can reach those.
- **`index.ts` on 565 hands on 74 files,** in both arms: every `index.ts` in
  the repo. A bare file name is a weak pointer whoever extracts it.

## Error messages

The tickets quote few outputs. By hand: 367 quotes a failing test's name,
504 a command's output, 565 an exit code. 490 and 579 quote none.

| # | quoted, by hand | Clairic's `error_messages` |
|---|---|---|
| 367 | the failing test's name | the test's name, whole; and `tea`, `OpenTelemetry suite` |
| 393 | none | `Bin` |
| 490 | none | none |
| 504 | `0 down, 0 sideways, 0 UP, 10373 unlayered` | `0 down,`, `compile`, `zero`, `[^/]*` |
| 565 | `exit 2` | `exit`, `dec`, `decidedBy`, `read` |
| 579 | none | `stop` |

One of three whole. Ten of thirteen items are not outputs at all.

## Spans, repeats, confidence, cost

- **Spans:** every value of every list had a span that is exactly that value,
  and every span was exactly some value. The text Clairic indexed into
  (`return_state_text`) was the text sent, on all 18 calls. A list keeps a
  span for each place a value appears, so a list can have more spans than
  values (565's `code_names`: 24 values, 42 spans).
- **Repeats:** the three runs of each ticket gave the same answers, spans and
  confidences, to the last digit. Clairic looks deterministic on the same
  input.
- **Confidence is one number a list, not a number an item.** The output
  schema has `confidence` on the list; there is no per-item score. So "is a
  low-confidence item more often wrong?" cannot be asked.
  - The list confidences ran from 1.3e-2 down to 3.1e-30.
  - Across the 12 name and path lists, their rank follows list length
    (Spearman -0.93) far more than the share of code (0.48).
  - A guess, not checked: it is the chance the whole list is exactly right,
    which shrinks with every item.
- **Cost:** 18 calls, 16,209 input tokens, $0.0016. Every call took 1 pass.
  `output_tokens` came back 0. The schema was 360 tokens a call, 32% to 50%
  of each call's input. The spend cap was $0.10.
- **Time:** median 185 ms a call, slowest 654 ms (the first call).
  `mentionsOf` takes 0.025 ms a ticket.

## What this means

- **Do not add Clairic to the plan stage for this job.** Why: it reached the
  same files, its list is 3.6 times longer, and half of it is noise. A
  planner handed `full`, `open`, `per` and `scoreCo` must read past them.
  Cost of not adding it: nothing; the code we have does as well. Sure: 80%.
  The doubt: six tickets, all written by agents who backtick their code. A
  ticket written by a person, with no backticks, is where an extraction model
  could win. A run on human-filed tickets would settle it.
- **Fix the folder gap in `mentionsOf` instead.** A bare path ending in `/`
  is dropped today. On 393 that folder held all 5 files the plan needed from
  it. Cost: one regex and a test. Sure: 75% that it helps; a folder of 58
  files (565) is a weaker pointer than a file.
- **The bigger lever is elsewhere.** Two thirds of what the planner read is
  not in the ticket text. A starting list taken from the text alone cannot
  cut most of the re-reading. Passing on what triage or an earlier agent
  already found is the place to look.

## What this cannot tell us

- **Other instructions.** The field instructions were written once and kept,
  as planned. Other wording, one field per kind, or a `text` field per item
  might give a cleaner list. Not tried.
- **Tickets written by people.** All six were filed by agents, with code in
  backticks, which is exactly what `mentionsOf` reads. Clairic's edge, if it
  has one, would show on prose-only tickets.
- **Whether a shorter list helps a planner.** No planner ran with any arm's
  list. The recall here is a ceiling on what the list could point at.
- **The hand labels are one reader's.** `layers` and `plumbing` (values in a
  JSON example) were called code; `otel` in the title was called prose. A
  few labels could go either way. The totals would move by a few items, not
  enough to close a 97% to 52% gap.
- **Six tickets, one repo.** The numbers are small. 13 of 36 is not a
  measured rate for other repos.
- **The model is a preview.** Its answers, price and output shape may change.
