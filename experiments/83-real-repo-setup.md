# 83. Real repo setup: one tsh.toml, and operate ticket=<url> is a whole line

Code and tests only: no agent, no Jev, no write to GitHub, $0.

```toml
# tsh.toml, in the folder tsh is started in
repo    = "acme/widgets"
work    = "~/fabrika/work"
rubrics = "rubrics"
own     = ["a-bot", "a-person"]
model   = "opus"
effort  = "medium"
budget  = 2
rounds  = 3
ship    = "read"
```

```
tsh -c 'operate ticket=https://github.com/acme/widgets/issues/12'
```

## What was asked

Make the build, review, ship and operate loop usable on a real repository
from one `tsh -c` line. Innovation mode: keep it small, add no new guard,
do not port today's fabrika.

## What changed, one commit each

1. **No sandbox lock.** `SandboxTicket`, `SandboxPullRequest`, `sandboxOnly`
   and `src/sandbox.ts` are gone, with every refusal and the tests that proved
   them. build and operate take any `https://github.com/<owner>/<repo>/issues/<n>`;
   ship and review take any pull request url. The repository comes from the
   url: build clones it to `<work>/<owner>/<repo>/clone`, keeps its working
   copies under `trees/<n>`, and opens the pull request there. operate's
   reviewer reads the clone of the pull request's own repository. Verdicts are
   posted on the pull request the url names.
2. **One config file.** `wip/src/tsh/config.ts` reads `tsh.toml` with
   smol-toml through Effect's FileSystem and Path. Every key may be left out;
   no file means every default. An unknown key or a bad value stops tsh with
   exit 2 before anything runs (`tsh: <file>: Expected no excess property at
   ["shipp"]`). Paths are taken from the file's folder, `~/` is the user's
   home. `TSH_OWN`, `TSH_REVIEWERS`, `TSH_CLONE` and `TSH_WORK` are gone;
   `TSH_HOME` and `TSH_SCRIPTED` stay. build and operate are always listed.
   The live `review` is listed when the file names a `repo` or a `clone`.
3. **Flag defaults.** tea-program's `flag(schema, description, {default})`
   and `withDefaults(flags, values)`: a default that does not fit its flag is
   refused where it is given, `readFlags` fills a missing flag from it (so a
   run keeps the value it ran with), and `listing` carries it. tsh's check no
   longer asks for a flag that has a default, and `--describe` prints
   `(default: …)`. fabrika fills ship, review, review-scripted, build and
   operate from the config. A flag on the line still wins.
4. **No merge queue is one more ship transition.** The enqueue answers
   `no_queue` and writes nothing, where it used to fail. The machine then sends
   `ship_merge` from a new `merging` phase: the head the gate passed, merged
   with GitHub's `mergePullRequest` and `expectedHeadOid`, by the first method
   the repository allows (squash, merge commit, rebase). Merged goes on to the
   tidy-up with the merge's commit; a moved head is read again under the same
   cap; a conflict goes back to the builder; a broken merge ends
   `stuck:merge_failed`, a new ending (22 ship names now).

## Proofs

- `bin/tsh -c 'operate --describe'` in a folder whose `tsh.toml` names a real
  repository prints every flag with its default: `--model … (default:
  "opus")`, `--rounds … (default: 3)`, `--ship … (default: "read")`.
- The line `operate ticket=https://github.com/<owner>/<repo>/issues/700`,
  checked against the list made from that file without running it: `line`,
  no flag on it, and the run would start with `{rubrics: "./rubrics", model:
  "opus", effort: "medium", budget: 2, rounds: 3, ship: "read"}`. The live
  review is listed, reading `<work>/<owner>/<repo>/clone`.
- The same line with a pull request's url is refused at the `ticket=`, exit 2.
- Tests: config read (missing file, empty file, every key, relative and `~/`
  paths, seven refusals); flag defaults in tea-program, in tsh's check and
  describe, and through the config; the merge on the machine (merged, part,
  moved then merged, moving past the cap, conflicts, broken, red checks never
  merged, resume, every Msg in every phase), on the ship program (six pull
  requests, five with no queue and one with, twice, same outcomes and writes)
  and on the GitHub writes over a scripted `gh` (two calls exactly, the method
  order, read-first answers, a lost answer, a moved head after the read).
- `pnpm typecheck && pnpm lint && pnpm test`, twice, both green: 88 files,
  1,593 tests each time. Main had 1,595; the sandbox lock's tests (35) went,
  and the new ones came.

## Findings

- **Experiment 69's `stuck:enqueue_failed` was the missing queue.** The
  sandbox repository has no merge queue, and the enqueue failed by design. With
  the merge transition, the same run would have merged.
- **`own` is the one key a real repository needs.** Left out, it is empty, and
  ship ends every pull request `skip:not_ours`. The default is safe but the
  loop does nothing useful until it is set.
- **`rubrics` defaults to `<tsh home>/rubrics`,** which nobody has made.
  Review fails at its first read until the file points at a folder with
  `code.md`, `doc.md` and `skill.md`.
- **The base branch is still `main`,** written into build (the working copy
  and the pull request's base). A repository on another default branch needs
  it in the config next.
- **A changed tsh.toml refuses a restart.** A run keeps the flags it first
  ran with, and the defaults are filled before they are kept. Kill tsh, change
  `model` in the file, `attach`, and the run is refused naming `model`. That
  is right, and it will surprise someone. Read from the code, not run.
- **Read mode cannot tell there is no queue.** It stops at the first write it
  would send, which is the enqueue, so it says "would enqueue" either way.
- **The merge write has never met GitHub.** It is tested over a scripted `gh`
  only, as the enqueue was before its first live run.

## Recs

1. First live run on a real repository: one small ticket, `ship = "read"`,
   then `ship = "write"` once the review lands. Confidence 70%: the merge
   write is unproven live.
2. Add `base` to tsh.toml (default `main`). Small, and the next repository
   will need it. Confidence 85%.
3. Ship the rubrics with the repository the file is for, and let `rubrics`
   default to `rubrics` beside the file. Confidence 75%.
