# Field notes

What happens when fabrika runs real work on kamp-us/demlik, written down as it
happens, so it can be counted later. A few rows are tea-fabrika's own parts run
on that same work, and each is marked as such.

tea-fabrika is built to fix what goes wrong in fabrika. The replay set
(`replay/`) checks tea-fabrika against old tickets. This folder is the other
half: what goes wrong (and right) in today's fabrika when it drives live lanes,
and which part of tea-fabrika would change it.

Two files, one record per line, so a script can read them:

- `notes.jsonl`: one observation each. Something broke, cost too much, needed
  a person, or worked well.
- `runs.jsonl`: one agent run each. Which role, which lane, how it ended, and
  what it cost.

## A note

| Field | What it holds |
|---|---|
| `id` | `<date>-<nn>`, in the order written |
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
| `date`, `lane` | as above |
| `role` | `operator`, `builder`, `reviewer`, `shipper`, `triager`, `planner`, or `machine` for a lane tea-fabrika's operator machine drove (`src/operator.ts`), or `acp` for a harness session the `acp` program drove (`src/agents/acp/`, experiment 76): no lane (`lane: null`), and leave these out of any baseline |
| `model`, `effort` | as spawned; `null` for `machine`. A `shipper` row with `model: null` is a ship stage the ship machine ran (`src/stages/ship/`), with no agent: its `tokens`, `tools` and `costUsd` are 0, and its Cmds are counted on the `machine` row |
| `outcome` | how it ended, one word: `merged`, `pass`, `fail`, `triaged`, `parked`, `stopped` |
| `why` | for `parked` and `stopped`, the reason in a few words |
| `tokens`, `tools`, `minutes` | what the run reported when it ended. `tokens` is the size of the run's conversation at its last turn: that is what a Claude Code subagent reports, and what a shell under the machine is logged with, so the two compare. For `machine`: `tokens` is 0, `tools` is the Cmds it sent, `minutes` is the whole lane |
| `note` | which `notes.jsonl` id explains it, if one does |
| `driver_caused` | `true` when the run stopped short because of the driver or the setup (told to stop, started on the wrong thing, a plugin reload), not the lane. Leave these out of any baseline |
| `costUsd`, `billed` | on the rows of a lane the machine drove, where the Agent SDK reports them. `costUsd` is the shell's dollars (on the `machine` row, all its shells'). `billed` is every token the shell was billed for, each turn's input counted again; it is many times `tokens` |
| `jev` | on a `machine` row only: the Jev calls it made |
| `replay`, `name` | on a `reviewer` row only. `replay: true`: not today's fabrika. It is tea-fabrika's own review piece (`src/stages/review/`), run alone on a head today's reviewer had already reviewed. It only read and posted nothing. `name` is the outcome's name it printed. `model: null` on such a row: its gate stopped it before any agent started. `minutes` is the agent's own time, or the whole run where no agent ran. `tools` counts the one call that hands the answer back. Leave these rows out of any baseline of today's reviewer. On a `planner` row too: tea-fabrika's plan program (`wip/src/stages/plan/`), run read-only on a closed ticket at its PR's base commit (experiment 86). `tools` there is `null` and `minutes` sums its drafts |

A `machine` run writes its own rows: `fieldRows` in `src/operator-host.ts`
turns a finished run into one `machine` row, one row per shell it ran, and one
`shipper` row per ship stage the ship machine ran.

Two things in that last row are put right by hand before it goes in
`runs.jsonl`, until the row writer is fixed (note 2026-10-12-04). It writes
`minutes: 0`, so the minutes are measured from the run's message file. And it
writes a sentence in `note`, so the sentence moves to a note and the row
points at it.

## What the numbers are for

The first questions to ask of these files:

1. How much of an operator's spend goes on deciding what comes next and on
   waiting, against building and checking? That is the cost the
   `machine-drives` idea claims to remove.
2. How often does a lane stop for a person, and how many of those stops did a
   person really need?
3. Which primitive comes up most in the fixes? That says what to build next.

## Adding to it

Write a note the same day, while the cause is still known. Keep it public-safe:
no local paths, no names, no secrets. Link public issues and PRs instead.
