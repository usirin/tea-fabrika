# pipeline: `@tea-fabrika/pipeline`

One line in an app tile runs one tracker ticket through every step. Today's version. Every step is
a real machine, the facts go on the ticket, and the app's own windows show them.

```text
tsh> pipeline --ticket 117            prints one line per step
tsh> pipeline --ticket 117 | runs     the runs window fills in as it goes
tsh> map --ticket 117                 another tile: the steps light up
tsh> runs --ticket 117 | trace        pick a run, see its turns
tsh> ticket --ticket 117              the asks, answered here
```

The order, in `packages/pipeline/src/stages/pipeline/machine.ts`:

```text
triage -> plan -> the person approves -> exam, when rules change -> test writer
       -> build -> mutation -> one review -> push -> the person's yes -> merge
```

## What it needs

`<home>/pipeline.json`, read when a lane starts:

```json
{"repo": "owner/name", "remote": "git@host:owner/name.git", "host": "github"}
```

`host` is `github` or `local`. `local` is a bare git remote and a file of pull requests, for proof.
`codex` names another program than the `codex` on the path. The repository holds
`.fabrika/fabrika.toml`, with `[[checks.run]]`, one `[agents.<step>]` table per step you want to
change, and its review rules in `[review]`. Each step defaults to Codex on `gpt-6-astra`, effort
`high`. Triage defaults to `claude` on `opus`.

`[review] rubrics` names a folder, read from a copy of main's tip, so a change cannot rewrite the
rubrics that judge it. Left out, the lane uses the rubrics fabrika ships. This holds on both hosts.

## On GitHub

`host: "github"` works through your own `gh`. It has run only over a stand-in `gh`
(`fixtures/pipeline-lane/gh.mjs`), never against real GitHub.

- **The review stays local.** It reads the head on this machine, and its checks are `[[checks.run]]`.
  The push step then opens the pull request and posts the verdicts as comments.
- **The lane's own verdicts count.** No GitHub approval and no reviewers list is read. A verdict counts
  only at the head it was posted for. If a person pushes after that, the lane ends `stuck: sent_back`.
- **The yes is yours, on the ticket.** A GitHub approval does not stand in for it.

Which checks ship waits on, from `[checks] github` at main, read on each call:

| `github` | What ship does |
|---|---|
| `every`, or left out | Waits on every check on the head. A failed one is run again once, then the work is sent back. |
| `required` | The same as `every`: ship still waits on every check, and a failed one sends the work back. `required` changes only what `CodeHost.change` reads for a pull request, and no step of the lane reads that. |
| `none` | Never waits on GitHub. It runs `[[checks.run]]` on this machine at the head it pushed, and those decide. A file with no `[[checks.run]]` is refused. |

- **A repository with no CI.** Under `every`, no check ever reports. Ship waits 15 minutes and the lane
  ends `stuck: checks_stuck`. Set `github = "none"` in `[checks]` to get past this.
- **A branch rule that wants a GitHub review.** GitHub refuses the merge, and the lane ends
  `stuck: merge_failed`. The ticket does not say which rule refused it: ship never reads the refusal's
  words.

## What it holds to

- **A ticket must be yours.** One filed by someone else is refused before any agent starts.
- **No agent approves.** Both yeses are a person's answer in the ticket window. Merge is `ship`, with
  its guards.
- **The builder cannot touch the exam.** A change to a file the test writer's commits touched, or to
  a rule file, ends the lane in `stuck:exam_touched`, and the ticket says so.
- **Closing a window loses nothing.** Ctrl-B x, y closes the runs window and the lane goes on. A second
  Ctrl-B x, y stops it. Typing the line again goes on from the ticket, and no finished step runs twice.
- **Each run records its brief.** Its name and hash go on `started`, as it starts.
- **A stuck lane is final.** Typing the line again says how it ended, and runs nothing.

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/pipeline` | `src/index.ts` | `pipeline`, the program: flag `ticket`, outputs `ticket` and `line`. Names no platform. |
| `@tea-fabrika/pipeline/node` | `src/node.ts` | `laneRunner(writer)`: lanes on this machine, in the host's process. |
| | `briefs/` | One plain file per step that runs an agent. The app's build copies them beside its bundle. |
| | `docs/` | Real shots from the built app, taken by `apps/fabrika/lane-e2e.ts`. |

The lane's logic is in `packages/pipeline/src/stages/pipeline/`. The write-up is
[experiment 175](../../experiments/175-pipeline-v0.md).

## Shots

| State and layout | What squeezes or looks wrong |
|---|---|
| ![](docs/filed-side-by-side.png) | The tracker says it could not read pull requests: a test home has no `gh`. |
| ![](docs/plan-asked-side-by-side.png) | The runs window says `0 runs` while the ticket's ask waits, since it counts finished clips. |
| ![](docs/plan-asked-three-tiles.png) | Fine. |
| ![](docs/merge-asked-three-tiles.png) | Fine. |
| ![](docs/merge-asked-2x2.png) | The map's text is too small to read at a quarter of the window. |
| ![](docs/merged-2x2.png) | Runs' ruler labels overlap the `approve` mark. Cost says `$0.00`: the price of `gpt-6-astra` is unknown. |
| ![](docs/merged-2x2-small-window.png) | Tile lines wrap hard at the edge. Trace's time ruler labels overlap, and the map is cut off below. |
| ![](docs/merged-one-tile.png) | Fine. |
| ![](docs/merged-stacked.png) | Fine. |

## How Linear would do it

It adds no window. The lane is a tile line, and the ticket, runs, map and trace windows draw it, so
the ticket stays the one place a person answers. Linear would put the step list in the issue's
sidebar too; ours is the ticket window's step bar, with `runs` for the detail. Where we differ: a
person types a line to start it, not a button, because tsh is the app's way to start anything.
