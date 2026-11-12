# Field notes

What happens when fabrika runs real work on kamp-us/demlik, written down as it
happens, so it can be counted later. A few rows are tea-fabrika's own parts run
on that same work, and each is marked as such.

tea-fabrika is built to fix what goes wrong in fabrika. This folder is the
half that records what goes wrong (and right) in today's fabrika when it drives live lanes,
and which part of tea-fabrika would change it.

Three logs. Each new row is its own small file in its log's folder, one JSON object per file,
and its id is its file name ([0090](../.decisions/0090-each-field-row-is-a-file.md)):

- `notes/`: one observation each. Something broke, cost too much, needed
  a person, or worked well.
- `runs/`: one agent run each. Which role, which lane, how it ended, and
  what it cost.
- `findings/`: one finding each, from this repo's own work. Something an agent
  found outside its task, and later a person's rating of it.

The rows written before ticket 562's build landed stay in `notes.jsonl`, `runs.jsonl` and `findings.jsonl`, one
per line, as history. Nothing is added to those three files any more, and nothing in them is
moved, edited or given a new id. A reader reads each folder and its old file together, and accepts
both id styles: the old counters (`2026-11-10-f36`, `2026-11-08-102`, `2026-11-02-r01`) and the
new names.

## How to write a row

A row's file is `field/<log>/<YYYY-MM-DD>-<slug>.json`: the date, then a short slug of lowercase
words joined by `-`. The slug says what the row is about, so two writers on one day rarely pick
the same one, and if they do, git shows a plain conflict on the same path. There is no counter.
The row's own id field holds the same name: `id` on a note or a finding, `run` on a run. A rating
has no id of its own; its file is `<date>-rated-<finding>`, with the date it was rated.

The fields do not change: each log's table below gives them. Write the row once and never edit it.
A correction is a new row (`corrects`, on a run).

[`fieldfile.ts`](../.agents/skills/lead/scripts/fieldfile.ts) saves rows for you, from a file of
JSON lines: `node .agents/skills/lead/scripts/fieldfile.ts <log> <rows>`, run from the top of the
repo. It names each file by the rules here, prints each path, and writes nothing if a name is taken
or missing.

A `step` run from a lane has the lane's run id, lane + step + n, such as `p39s1-tests2` (lane
`p39s1`, its 2nd tests run; `RunId.next` in the lead's `runid.ts` makes it), which has no date. Rows
from before 2026-11-11 have `t<ticket>-<step><n>`, such as `t562-tests1`. Its file puts the row's
date in front, `2026-11-11-p39s1-tests2.json`, and its `run` becomes that same name. 0090 left this open; this is the plain reading, used by `fieldfile.ts`, and not decided.

One example per log. A file holds one object; the indent is the writer's choice.

```jsonc
// field/notes/2026-11-11-hand-merge-pushed-conflict-markers.json
{"id": "2026-11-11-hand-merge-pushed-conflict-markers", "date": "2026-11-11", "lanes": ["tea-fabrika#562"],
 "stage": "harness", "kind": "failure", "what": "A hand merge pushed conflict markers into a field log.",
 "cause": "two PRs each appended a line", "person": true, "primitive": null, "fix": "one file per row",
 "test": null, "links": []}

// field/runs/2026-11-11-p39s1-tests2.json, a lane's step row
{"date": "2026-11-11", "run": "2026-11-11-p39s1-tests2", "ticket": "usirin/tea-fabrika#562", "pr": null,
 "started": "2026-11-11T09:02:10-08:00", "ended": "2026-11-11T09:20:41-08:00", "parent": null,
 "active": null, "role": "hand", "step": "tests", "model": "gpt-6-astra", "effort": "high",
 "outcome": "pass", "why": "drive.ts tests in box t562: done.", "tokens": null, "tools": null,
 "minutes": 18.5, "note": null, "costUsd": null, "billed": null}

// field/findings/2026-11-11-catchup-waits-on-dirty-pr.json
{"_tag": "finding", "id": "2026-11-11-catchup-waits-on-dirty-pr", "date": "2026-11-11", "by": "lead",
 "model": null, "rule": "bug", "location": {"path": ".agents/skills/lead/scripts/catchup.sh", "line": 1},
 "says": "…", "proof": "…", "cost": "…", "head": "<the full sha>", "ticket": null, "pr": null}

// field/findings/2026-11-12-rated-2026-11-11-catchup-waits-on-dirty-pr.json, its rating
{"_tag": "rated", "finding": "2026-11-11-catchup-waits-on-dirty-pr", "says": "noise", "by": "owner",
 "date": "2026-11-12", "ticket": null}
```

The values above are made up, to show the shape.

## What CI checks

Today's CI checks field records for both versions. On a pull request, it checks what the pull
request adds since the merge base. On main, it compares the push's before and head commits.

The `field` job in [check.yaml](../.github/workflows/check.yaml) runs
[field-check.ts](../.github/ci/field-check.ts). It reads each changed `field/*.jsonl` file and each
changed path in `field/notes/`, `field/runs/` and `field/findings/`, and reports the number of added
rows, including zero. Missing history fails the check.

- **An added row file** must be named `<YYYY-MM-DD>-<slug>.json`, hold one JSON object, and pass
  the field rules below. Its id (`id` on a note or a finding, `run` on a run) must be its file name
  without `.json`; a missing or different id fails. A `date` that differs from the name's date
  only warns.
- **A changed or deleted row file** fails: a row is never edited or removed.
- **A line added to `notes.jsonl`, `runs.jsonl` or `findings.jsonl`** fails, whatever it holds, and
  the error names the folder the row belongs in. An edit there is an added line too.
- An unknown direct `field/*.jsonl` file gets the JSON object check per added line, and a warning
  that it has no detailed schema.

Each added row must be a valid JSON object. The measured core fields and types in
[field-schema.ts](../.github/ci/field-schema.ts) also block on errors:

- All three logs require a string `date` shaped as `YYYY-MM-DD`.
- Notes require string `id`, `stage`, `kind` and `what`, an array `lanes`, and
  string or null `fix`. If present, `cause`, `primitive` and `test` are string or
  null, `person` is boolean, and `links` is an array of strings.
- Runs require string `role`; string or null `model`, `effort`, `outcome`, `note`
  and `why`; and finite, nonnegative numbers or null for `tokens`, `tools` and
  `minutes`.
- If present on a run, `run` is a string; `started`, `ended` and `parent` are
  string or null; and `driver_caused` is boolean. `active`, `costUsd`, `listUsd`,
  `billed`, `inputTokens`, `cachedTokens` and `outputTokens` are finite,
  nonnegative numbers or null. `plants` is an array of `{law, plant, result}`, two strings and
  `red` or `green`.
- A findings row has `_tag` `finding` or `rated`. A finding requires every field in
  [its table](#a-finding): `rule` from the closed list; `location` as `{path, line}`, with text
  for the path and a whole number from 1 for the line; `says`, `proof`, `cost` and `by` with
  something written in them; string `id` and `head`; string or null `model`, `ticket` and `pr`.
  The key `at` on a finding is an error: the place is `location`. A rating requires string
  `finding`, `says` as `fix` or `noise`, `by` with something written in it, and string or null
  `ticket`.

Extra fields are allowed. Ticket and PR forms do not block. Unknown facts can
stay null or absent where the schema allows it. Do not invent zero or success.

Missing README metadata, words outside its stage, kind, role and outcome lists,
non-string lane members, unusual references, dates, timestamps or URLs, and inconsistent times or
counts only warn. A `parent` or a rating's `finding` that is neither an old counter id nor a
`<date>-<slug>` name warns. A finding's `head` that is not a full sha, and a path that is not
repo-relative, only warn too. Warnings exit with code 0. The tables below guide writers; their
stricter wording does not add blocking rules.

## A note

| Field | What it holds |
|---|---|
| `id` | its file name, `<date>-<slug>` (`<date>-<nn>` on old rows) |
| `date` | the day it happened, `YYYY-MM-DD` |
| `lanes` | the tickets it touched, as `repo#n` |
| `stage` | where in the pipeline: `report`, `triage`, `plan`, `ruling`, `build`, `review`, `ship`, `harness` (the tools around the pipeline) or `driver` (the agent or person running it) |
| `kind` | `failure` (a run stopped or did the wrong thing), `friction` (it worked, slowly or by hand), `cost` (it worked, for too much), `success` (worth copying) |
| `what` | what happened, in plain words |
| `cause` | why, when checked; `null` when only guessed |
| `person` | `true` when it stopped and waited for a person |
| `primitive` | the tea-fabrika part that would change it: `Gather`, `Act`, `Listen`, `Draft`, `Check`, `Judge`, a combo (`refine`, `gate`, `ask`, `remember`, `spawn`), `typed-answer`, `hand-written-parent` or `machine-drives` |
| `fix` | what that part would do here |
| `test` | how to check the fix: an experiment, or a replay measure |
| `links` | public URLs |

## A run

| Field | What it holds |
|---|---|
| `date` | as above |
| `run` | the row's own id, so `parent` can name it: its file name, `<date>-<slug>`. On a `step` row, the lane's run id from its `ended` fact, with the row's date in front (see [How to write a row](#how-to-write-a-row)). Old rows have `<date>-r<nn>`, or a lane's id alone. Added 2026-11-01 |
| `ticket` | the ticket the run served, as `<owner>/<repo>#n`: a tracker ticket on this repo's own tracker, or a GitHub issue elsewhere. `null` when there is none. Added 2026-11-01 |
| `pr` | the pull request the run served, as `<owner>/<repo>#n`, or `null`. A run on both writes both. Added 2026-11-01 |
| `lane` | old rows only. Before 2026-11-01 one `lane` held either a ticket or a PR, written the same way, so this repo's `#141` is a ticket and its `#267` a PR; read `why` to tell. It stays readable on those rows. New rows write `ticket` and `pr`, never `lane` |
| `started`, `ended` | when the run started and ended, on the writer's own clock, as ISO 8601 with its offset. `minutes` stays beside them. `ended` is `null` while the run is open, and an open run is unknown, never zero. Added 2026-11-01 |
| `parent` | the `run` of the run that started this one, or `null`. So a driver is never summed with its children ([agent hours](../docs/direction/agent-hours.md#h2-every-run-on-the-work-counts-failed-ones-too-and-a-driver-never-does)). Added 2026-11-01 |
| `active` | minutes a model or tool was working, beside the wall-clock `minutes`, where the run can say; `null` until something records it. Added 2026-11-01 |
| `role` | `operator`, `builder`, `reviewer`, `shipper`, `triager`, `planner`, or `machine` for a lane tea-fabrika's operator machine drove (`legacy/src/operator.ts`, the old first generation), or `acp` for a harness session the `acp` program drove (`packages/fabrika/src/agents/acp/`, experiment 76): no lane (`lane: null`), and leave these out of any baseline. `hand` is a subagent a person's own Claude Code session started by hand, not a lane our machine or today's fabrika ran: `ticket` and `pr` are the tracker ticket and the PR it served (on old rows, `lane`, as `<owner>/<repo>#139`), and `parent` is the `session` row that started it. Leave these out of any baseline too. `session` is a person's own main Claude Code session, logged as a run of its own from 2026-11-01, one row per stretch of work, with `parent: null`. Its `minutes` cover the subagents it started, so a reader never adds it to the rows whose `parent` it is; its `why` says what it did itself. `pipeline` is a whole lane run by today's `pipeline` program (`programs/pipeline`), and its `why` says which parts were this repo's machine. `driver` is a Claude subagent that carried a ticket or a job for the lead session by starting other agents (Claude subagents or Codex steps), from 2026-11-08; its `parent` is the driver that started it, or `null`, and its children name it as their `parent`, so a reader never adds a driver to its children. `step` is one agent run inside such a lane, on one of the steps that runs an agent: `triage`, `plan`, `exam`, `test_writer`, `build`, `mutants`, `review`. Both have `ticket` as `<owner>/<repo>#n` (on old rows, `lane`), a `step` row's `parent` is its `pipeline` row, and their `why` starts `pipeline, tracker ticket <n>, <step>:` (the `pipeline` row leaves out the step). An older row can have the same `lane`, such as a `hand` row on 2026-10-26 with `#117`: that one is work by hand under that number, not this pipeline, and its role and `why` tell them apart. Added 2026-11-01; [the how-to](../docs/how-to/run-a-pipeline-ticket.md) says how to log them |
| `model`, `effort` | as spawned; `null` for `machine`. On a `hand` row, a model the spawn left unset is the main session's, and an unset effort is `null`. A `shipper` row with `model: null` is a ship stage the ship machine ran (`src/stages/ship/`), with no agent: its `tokens`, `tools` and `costUsd` are 0, and its Cmds are counted on the `machine` row |
| `outcome` | how it ended, one word: `merged`, `pass`, `fail`, `triaged`, `parked`, `skip`, `stopped`. On a `pipeline` row, from the lane's verb: `done` is `merged`, or `triaged` when triage closed the ticket; `ask` is `parked`; `skip` and `stuck` are `stopped`, with the outcome's name in `why`, such as `stuck:step_stuck` and the step's own word. A lane never ends on `send`. On a `step` row: `done` is `pass`; `send` is `fail`, with where it went in `why`; `ask` is `parked`; `skip` is `skip`, so review's order check counts a skipped mutation step; `stuck` is `stopped` |
| `why` | for `parked` and `stopped`, the reason in a few words. On a `hand` row, what the run was for, then the reason if it stopped |
| `tokens`, `tools`, `minutes` | what the run reported when it ended. `tokens` is the size of the run's conversation at its last turn: that is what a Claude Code subagent reports, and what a shell under the machine is logged with, so the two compare. For `machine`: `tokens` is 0, `tools` is the Cmds it sent, `minutes` is the whole lane. For `hand`: they are what the subagent reported when it last finished (`subagent_tokens`, `tool_uses`, `duration_ms`). A subagent that was sent more work after it finished counts as one run, so `tools` and `minutes` cover all of it. All three are `null` when it was stopped before it reported. For `step`: the lane does not capture `tokens`, the last turn's size, so it stays `null`. Its numbers are in each step's printed line and in the fact the lane writes on the ticket when a run ends (`input`, `output`, `cached`, `turns`, `minutes`, `model`, `effort`). `minutes` comes from there, `tools` stays `null`, and `billed` is `input` plus `output`. Nothing writes these rows yet, so a person or agent copies them |
| `note` | which note's id explains it, if one does |
| `driver_caused` | `true` when the run stopped short because of the driver or the setup (told to stop, started on the wrong thing, a plugin reload), not the lane. Leave these out of any baseline |
| `costUsd`, `billed` | on the rows of a lane the machine drove, where the Agent SDK reports them. `costUsd` is the shell's dollars (on the `machine` row, all its shells'). `billed` is every token the shell was billed for, each turn's input counted again; it is many times `tokens` |
| `listUsd` | on a GPT sol or GPT luna row only, where the tokens were saved: what the run's tokens cost at OpenAI's standard API price (`experiments/lib/list-price.ts` says which price and when it was read). GPT sol runs on the ChatGPT plan, which bills no call, so `costUsd` stays `null` on those rows. Added on 2026-10-30 to experiments 159 to 163's triage rows (`STEP=listprice` in `experiments/163-triage-ask.ts`); nothing else on those rows changed <br>From 2026-11-08 also on a Claude Code subagent's row: its tokens priced at Anthropic's list price (the pricing page and the date read are in the row's `why`), written by `.agents/skills/lead/scripts/clauderow.ts` (`clauderow.py` until 2026-11-12) from the subagent's transcript. A Claude subscription bills no call either, so `costUsd` stays `null`. On those rows `inputTokens` counts every input token (uncached, cache writes and cache reads) and `cachedTokens` the cache reads, as on a Codex row; the split of cache writes into 5-minute and 1-hour is in `why`, since the two are priced apart |
| `corrects` | the `run` of an earlier row that this row puts right. The earlier row stays as written; a reader takes the newest row that names it and leaves the earlier one out of any sum. Its own `run` is the earlier one's with `-c1` (then `-c2`). Added 2026-11-08 |
| `billing`, `product`, `env` | optional, on any agent run from 2026-11-07, and left out when not known; older rows are not changed. `billing` is how the run was paid: `subscription` or `key` (billed per token), read from Claude's `apiKeySource` on its first `system/init` message or the SDK's `accountInfo()`, or from Codex's auth mode (`chatgpt` or `apiKey`). A Claude subagent's transcript has no `system/init` line, so on a `clauderow.ts` row `billing` is what the lead gave and the row's `why` says so. `product` is the subscription's name as the provider gives it (`max`, `pro`), from Claude's `subscriptionType` or Codex's `planType`, cross-checked with its rate-limit snapshot's `plan_type`. `env` says whether each key variable was set, as `true` or `false` and never the value: `{"ANTHROPIC_API_KEY": false, "ANTHROPIC_AUTH_TOKEN": false, "OPENAI_API_KEY": false, "CODEX_API_KEY": false}`. A run with a key set still runs; this only records it ([the meter on subscriptions](../docs/direction/one-ask-and-one-meter.md#the-meter-on-subscriptions)). Later, not yet on these rows: the last percent of each limit used with its window and reset time, why each turn woke, the context size and cache reads and writes per turn, and how long each ask waited on a person |
| `jev` | on a `machine` row only: the Jev calls it made |
| `replay`, `name` | on a `reviewer` row only. `replay: true`: not today's fabrika. It is tea-fabrika's own review piece (`src/stages/review/`), run alone on a head today's reviewer had already reviewed. It only read and posted nothing. `name` is the outcome's name it printed. `model: null` on such a row: its gate stopped it before any agent started. `minutes` is the agent's own time, or the whole run where no agent ran. `tools` counts the one call that hands the answer back. Leave these rows out of any baseline of today's reviewer. On a `planner` row too: tea-fabrika's plan program (`wip/src/stages/plan/`), run read-only on a closed ticket at its PR's base commit (experiment 86). `tools` there is `null` and `minutes` sums its drafts. In experiment 136 it is the plan stage's planner options (`packages/pipeline/src/stages/plan/planner.ts`), asked only whether a closed ticket's first title and body join an open ticket (or, in part B, what its pull request should carry), with no plan written; `tools` counts its Read, Grep and Glob calls, `tokens` is its context at the last turn, and `name` is `null`. On a `triager` row too: tea-fabrika's sort (experiments 88 and 92; 92's `why` names which brief), one call with no tools on a closed ticket's first title and body. `name` is what it said (`plan`, `ruling`, `research`, `no` or `dup`); `tokens` and `billed` are that one call's. In experiments 133 and 133b it is today's sort brief and Check (`packages/pipeline/src/stages/sort/`), up to two calls, and `name` is the outcome's name, such as `send:plan:fold`. Leave these out of any baseline of today's triager |
| `attested` | on a `next/` step's row from P32 on: the links the step signed, one per commit it made, in commit order. See [A step's links](#a-steps-links). Added 2026-11-07 |
| `plants` | on a `step` row whose agent ran plants ([0093](../.decisions/0093-laws-walk-plants-run-once.md)): each break it planted once and undid, as `{law, plant, result}`. `law` is the law it tested (`file:line` or its title), `plant` what it broke (`file:line` and how), and `result` is `red` when the law failed on it or `green` when the law did not catch it. drive.ts copies them from the `plants` key of the step's typed answer, the JSON object that ends its report; a row with none leaves the key out. Added 2026-11-11 |

### A step's links

In Tier 1, until `next/`'s ledger exists, a step's signed links live here
([a unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md#squash-merges-stay-each-step-signs-a-link-from-tree-to-tree)).
After a pull request merges, `pnpm commits chain` walks them from `main`'s tree to the squash
commit's tree (laws p86 and p89 in [the detail](../docs/plan/tier-1-detail.md#properties)). A
pull request that adds them is blocked until they walk. Each link is the JSON line `pnpm commits sign`
printed, plus what only the person logging it knows:

```ts
{_tag: "attested", step: "build", ticket: "229", version: 1,          // what the key signed, with `from` and `to`
 from: "9e02a1c…", to: "c7a8f55…",                                  // the trees before and after, full shas
 key: "SHA256:Bx9…", sig: "-----BEGIN SSH SIGNATURE-----\n…",       // the key's fingerprint and the whole SSHSIG text
 commit: "b72d9e4…",                                                 // the step's commit, as `sign` printed it
 by: "agent:builder", arrivedAt: "2026-11-07T21:40:56-08:00",        // who signed, and when this row was written
 cause: null,                                                        // the input that started the step; null in Tier 1
 pr: "usirin/tea-fabrika#450",                                       // the pull request, written as `pr` above
 base: "4b1d0e7…", squash: "e5f6a7b…",                               // main's commit at the start, and the squash commit
 keys: "4b1d0e7…"}                                                   // the main commit whose allowed_signers checked it
```

- Every field is required, and every sha is the full 40 hex. A link that does not read fails the
  check, so a typo is caught on the log's pull request, not later.
- `ticket` and `version` are part of what was signed. Only a step's newest `version` for a ticket
  counts: an older one the squash still uses, or a newer one it does not, is `stale_link`.
- The squash is known only after the merge, so a step's links usually land in a log pull request
  a little after it. On `main`, a squash with no links yet is only advised about.
- Not yet read from row files: `pnpm commits chain` (`next/apps/fabrika/src/exam/commits.ts`) reads
  links only from `runs.jsonl`, which takes no new line. Until it reads `runs/` too, a link written
  in a row file is not walked. That change is exam code, so it goes through the steps.

A `machine` run writes its own rows: `fieldRows` in `legacy/src/operator-host.ts`
(the old first generation) turns a finished run into one `machine` row, one row per shell it ran, and one
`shipper` row per ship stage the ship machine ran.

Two things in that last row are put right by hand before it goes in
`runs/`, until the row writer is fixed (note 2026-10-12-04). It writes
`minutes: 0`, so the minutes are measured from the run's message file. And it
writes a sentence in `note`, so the sentence moves to a note and the row
points at it.

## A finding

An agent that finds work outside its task writes one row here and keeps going. It does not fix it,
file a ticket, or only mention it in its report
([0035](../.decisions/0035-outside-work-becomes-finding-rows.md)). These rows are about this repo's
own work, in either version. They move into `next/`'s ledger when it holds findings (Tier 6), so
the keys follow the proposed shape in
[every finding is rated](../docs/direction/every-finding-is-rated.md).

A `flaky_test` is the one exception: it also gets a tracker ticket and a fix the same day, and
its row does not wait for a rating
([0036](../.decisions/0036-a-flaky-test-is-fixed.md)).

A row needs proof to be written at all: `location`, `proof` and `cost`. Never write a security hole
here. Rows are only added, never edited or deleted.

| Field | What it holds |
|---|---|
| `_tag` | `finding` |
| `id` | its file name, `<date>-<slug>` (`<date>-f<nn>` on old rows) |
| `date` | the day it was found, `YYYY-MM-DD` |
| `by` | the step or job the agent was running: `plan`, `tests`, `build`, `mutation`, `review`, `lead`, or the job's own name |
| `model` | the model as spawned, or `null` when not known |
| `rule` | one of `bug`, `dead_code`, `duplicate`, `missing_test`, `flaky_test`, `doc_drift`, `rule_break`; the decision says what each is. A finding that fits none is not written: say so in the report |
| `location` | where it is, as `{path, line}`: a repo-relative path and a line at `head`. For something missing, the line of the code it is about |
| `says` | what is wrong, in a sentence |
| `proof` | how it fails or how you know: the command and what it printed, or the two lines that disagree. Reading one function is not proof |
| `cost` | what it costs if left |
| `head` | the commit it was seen on, the full sha |
| `ticket`, `pr` | the work it was found during, as `<owner>/<repo>#n`, or `null`, written as on a run |

A rating is a row of its own, written by a person's tool: by hand, or by the lead session writing
down the owner's call, until a window exists. The agent that found a row never rates it, and no
agent rates. A row never rated counts as noise once the pull request it was found during ships;
nothing is written for that.

| Field | What it holds |
|---|---|
| `_tag` | `rated` |
| `finding` | the `id` of the finding row; the rating's file is `<date>-rated-<finding>` |
| `says` | `fix` or `noise` |
| `by` | who rated, as a role: `owner` |
| `date` | the day it was rated |
| `ticket` | for a `fix`, the tracker ticket it became, as `<owner>/<repo>#n`; `null` for `noise` |

## What the numbers are for

The first questions to ask of these files:

1. How much of an operator's spend goes on deciding what comes next and on
   waiting, against building and checking? That is the cost the
   `machine-drives` idea claims to remove.
2. How often does a lane stop for a person, and how many of those stops did a
   person really need?
3. Which primitive comes up most in the fixes? That says what to build next.
4. For each `by` and each `rule` in the findings: how often was it noise? That sets
   how high the bar for writing a finding is.

## Adding to it

Write a note the same day, while the cause is still known. Keep it public-safe:
no local paths, no names, no secrets. Link public issues and PRs instead.
