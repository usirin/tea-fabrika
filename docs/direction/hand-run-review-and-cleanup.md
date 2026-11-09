# Hand-run review, cleanup and saved waits

Decided by the owner 2026-11-08, tracker ticket 318. Today's hand-run tooling, used for work in
either version. This changes no `next/` code.

```text
unsigned plan or amendment -> draft check -> saved wait -> lead session reads and signs
review -> every law and decided note -> one complete answer, plus follow-up tickets
driver waits -> save state outside its box -> end -> fresh driver reads current facts
successful merge -> retain checked head in MAIN -> remove safe working copies
exam diff -> labels + loosening check + mutation narrowing list -> no hits, no owner read
```

## Review answers once

Sweep every law in the approved plan. List each public call, cut point and saved or binding
state. A finding names its class and every case of it. Examples fail a law when a found case
escapes the class the plan names. On re-review, read every changed line from the last fixes
and its callers first, then finish the checks. Keep the four reason labels from
[every law is a property](./five-steps-for-every-check.md#four-reason-labels-2026-11-08).

Read every decided note the PR builds, using the plan and the change itself. Name each checked
note and where the change follows or breaks it. Block only on a broken decision in
`docs/direction` or `AGENTS.md`, lost data, or a broken law. Cite the source and the missed case.
Other actionable findings become tracker tickets. Every agent may file; it claims no work.
Use an existing ticket when possible. If filing fails, give lead the exact pending payload.

The answer starts with `merge-ready; tickets: <m>` or `changes: <n>; tickets: <m>`.
Count blocking classes as `n`, and distinct confirmed linked tickets as `m`. Give all findings
at once, grouped by class, most serious first. Pending filings do not count or start another review.
The [review skill](../../.agents/skills/review/SKILL.md) holds the full instructions.

## Keep commits before removing working copies

Only after a successful merge, catch-up keeps its checked head under `refs/keep/pr/<pr>` in MAIN.
This keeps signed step commits after a squash and remote branch deletion. Then it removes its
registered `catchup-<pr>` worktree, exact-branch boxes through `box.sh rm`, and the driver's linked
MAIN worktree on that exact branch. It never removes MAIN. Linked worktrees use normal
`git worktree remove`, without force. Dirty, locked, ambiguous or unreadable copies stay.
Each retained item gets a reason line. Cleanup continues and never turns a landed merge red.

`box.sh rm <name>` removes only the named work and git-data pair under canonical BOXES. It rejects
unsafe names, symlinks and bad metadata. It checks Git from MAIN through a temporary inspection
gitdir, without the box's config or hooks or inherited settings. Tracked files must be clean.
Untracked-only files and ignored installs may go. Every local branch, detached HEAD, stash and
step-note tip must be reachable under a retained MAIN ref. Objects alone and remote-tracking
refs do not count. Fetch remote-only work into a retained MAIN ref before retrying.
HEAD, ORIG_HEAD, refs outside refs/remotes/ and reflogs outside logs/refs/remotes/ need that proof; FETCH_HEAD is a fetched copy, and ORIG_HEAD and config.worktree are ordinary metadata. Keep operation or linked-worktree
metadata, unknown state, and any pair holding MAIN or BOXES/state.
Before each box or worktree removal, read MAIN's gitdir, common directory, object directory and
all alternates from outside. Keep their paths and every link they use. Refuse a removal that
contains any of them, even when the final destination is outside the removed path. Read only
MAIN's own bindings for this check. Never follow a box's config.
An annotated tag's own object ID must be reachable under MAIN's retained refs. Keeping only its
commit loses the annotation. Signed tags and nested tags need the same proof for their objects.

Both paths absent succeeds. One missing keeps the other. Removal or absence exits 0, a refusal
or operating error exits 1, and bad arguments or names exit 2. Partial removal is reported.
Saved plans, reports, logs and `state/` stay outside boxes and remain after cleanup.

## End drivers at waits

A Codex box, parent build, CI, plan approval or owner read is a wait. Save completed field work,
then atomically replace `$BOXES/state/<name>.md` with the new state. End the driver session.
The [lead skill](../../.agents/skills/lead/SKILL.md) holds the state and brief templates.
Lead checks the saved clearing fact and starts a fresh driver when it holds. That driver reads
the current branch, SHA, reports and checks. It skips completed steps and listed field rows.
Missing or unclear state sends it back to those facts. Background commands may keep running.

A ticket's driver is not the lead session. Every plan and amendment returns unsigned after
`plancheck.sh --draft`. The driver saves that wait and ends. Only the lead session reads and
signs each plan and amendment itself. Shared shell access cannot prove session identity.
Do not add a marker, key or readable file as proof.

## Exam reads follow the checks

Every new or changed law is a property or has a fitting vector, format, pinned or scenario label
with its reason. Run `loosening.sh <base> <head> [mapping.md]` over the exam diff. The PR writes
the exact removed and replacement test titles in a table headed `Removed` and `Replacement`.
`loosening.sh` fails closed: any exam-file change other than purely new tests or a rename listed
in the mapping table is a hit. A pattern parser cannot cover every TypeScript form, so it names
forms it knows but never clears a change it does not understand.
Removed or muted laws, removed assertions, fewer runs and tighter generated ranges are hits.
The mutation arm-a vs arm-b narrowing list also counts: main kills a mutant the branch lets live.
Zero hits from both checks, plus the labels rule, needs no owner read.
The lead records both outputs in the PR. A hit goes to the lead's hand check, with the hit list
in the PR. Only real loosening waits on the owner. Measure false alarms on the last 20 merged
`next/` PRs and record the count before the new loosening check blocks anything.

## Why, cost and limits

[Google's review guide](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
checks design, missed cases and tests. Git supplies stable
[status output](https://git-scm.com/docs/git-status) and guarded
[worktree removal](https://git-scm.com/docs/git-worktree). Isolated inspection avoids programs
named by a box's Git config. Retention keeps signed work. Saved waits free driver sessions.
The cost is fuller reviews, metadata checks and lead-owned restart timing. Confidence: 85%.

Phrase checks protect the written instructions. They cannot prove a thorough review or who
signed a plan. Saved Markdown cannot restart a driver itself. Generated laws cannot cover every
filesystem failure. A retained box needs a fresh read before a later removal.
