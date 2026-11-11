# The plan

Start here. Where this project is going, where it is today, and what to read for your
job. Two minutes.

## The one idea

Two versions live side by side. Today's version keeps running for daily use. The new one
grows in `next/`, on [the five layers](../direction/a-local-first-sync-engine.md). When
the new one takes a job over, the pull request that switches deletes the old part.

```text
next/             what we are building, on the decisions in docs/direction
everything else   what we use today, and a map of which jobs exist
```

## Where we want to go

Order changed 2026-11-05 by the owner: `next/` no longer waits on today's pipeline. *It was,
from 2026-11-01: finish the pipeline, watch it build a real ticket, then switch to `next/`.*

1. **Land [PR 267](https://github.com/usirin/tea-fabrika/pull/267).** Today's pipeline
   learns to handle what real agents answer. Done 2026-11-01.
2. **Ticket 117 waits.** Today's pipeline is paused. Tickets 117, 213 and 159 stay saved at
   their asks, and nothing is lost by the wait.
3. **Build `next/` now.** The owner approved what [Tier 1](./tier-1.md) builds on 2026-11-01.
   The lead session's agents build it by hand, in
   [37 small pull requests](./tier-1.md#the-pull-requests-one-at-a-time), each with the steps
   the pipeline enforces: a plan, tests written first and red, the build, one review by a
   separate agent, and the lead agent's read of the diff, green CI and a leak grep before merge.
   Mutation runs hourly against main instead of in each pull request
   ([0066](../../.decisions/0066-mutation-runs-on-a-schedule.md)); *it said: the fast mutation
   check, as a step.* Each step that goes by hand is logged in `field/`.
   [PR 223](https://github.com/usirin/tea-fabrika/pull/223) is read, and each layer lands
   already fixed.

On today's version, beside Tier 1: `runs` is gone and `trace` is the ticket's view (ticket 141,
[PR 338](https://github.com/usirin/tea-fabrika/pull/338), 2026-11-03); then the performance
program (ticket 114). They and Tier 1 do not wait for each other. Past Tier 1,
[seven tiers](./tiers.md) in all, the rest proposed.

Ticket numbers are this project's own tracker, not GitHub issues.

Ticket 325 builds skills friction slice 1b in today's hand-run tooling: K6 leak checks, K9 machine
limits and K20 advice on `next/` test data. Its checks and prose cuts are in build; slice 1a keeps
K19, K1 to K4 and K11. [The decision and replay](../direction/skills-hold-only-judgment.md).

**The deal, decided 2026-10-31:** every pull request, `next/` or today's, goes through
today's pipeline programs. A step that cannot run yet goes by hand for that pull request
and is logged in `field/` ([the note](../direction/next-is-a-pipeline-pre-run.md)).
*Changed 2026-11-05 for `next/`:* with today's pipeline paused, every step of a `next/` pull
request goes by hand, by its own agent, and is logged.
[PR 396](https://github.com/usirin/tea-fabrika/pull/396) recorded this in `docs/direction` and
`AGENTS.md`.

## Where we are now

**Tier 1, dated 2026-11-11.** 20 of [its 43 rows](./tier-1.md#the-pull-requests-one-at-a-time)
are on main, plus P17a, half of P17, so `next/` is on main now: the exams (P1, P2, P8, P30, P32,
P35), the spikes and the sheet's design pass (P3 to P5), the design package (P31), and the layers
from P6 to P12 and P16, with P33, P34 and P37. *It said, dated 2026-11-09: 19 rows.* No Tier 1
row merged on 2026-11-11.

*2026-11-11:* in `next/`, a running copy of fabrika is an instance in code too (ticket 681,
[0080](../../.decisions/0080-a-running-copy-is-an-instance.md)): `local-instance.ts`,
`instance.json`, the `INSTANCE` binding and the `node/dev` subpaths, with a lint rule,
`fabrika/no-stage-word`, that keeps the old word out. Alchemy's own `stage` keys and two saved quotes keep the word.

*2026-11-11:* big rows are cut into stacks of slices of at most 600 product lines each
([0087](../../.decisions/0087-a-pull-request-caps-product-lines.md)). P13, notes (ticket 281), is
re-planned as 4 slices; slice 1, durable terminal replies, is being built on a fresh branch, and
the old branch is not continued ([0072](../../.decisions/0072-a-churning-lane-is-redone.md)). P34c
(ticket 404) has an approved plan cut into 10 slices; slice 1, structured exit reasons, is being
built. P38, settings (ticket 664), is planned in 7 slices; slice 1, the local port as a declared
setting, is being built, on [0086](../../.decisions/0086-settings-are-declared-once.md) and
[the settings note](../direction/settings.md), both on main. P14 (ticket 286) is
[PR 810](https://github.com/usirin/tea-fabrika/pull/810), too large for the cap, so it is being cut
into slices, and its restack plan is being written. Outside Tier 1, ticket 702 builds slice 1 of
[0095](../../.decisions/0095-a-service-file-holds-only-its-contract.md): `ledger/Ledger.ts` holds
only the `Ledger` contract, its layers are `LedgerSql.ts` and `LedgerRemote.ts`, and the Cloudflare
`Sql` adapter moves to `cloudflare/`; slice 1 merged as
[PR 891](https://github.com/usirin/tea-fabrika/pull/891). Its slice 3 (ticket 723) is being built:
`Referee.ts` and `LedgerTransaction.ts` hold only their contracts, and their layers are
`RefereeSql.ts` and `LedgerTransactionSql.ts`. No Tier 1 row changes. → the lead lands each slice once its
steps pass

*2026-11-09:* the local instance, P12, landed as
[PR 530](https://github.com/usirin/tea-fabrika/pull/530). P17a, half of the chaos row, landed too
([PR 537](https://github.com/usirin/tea-fabrika/pull/537)). P16, one built file, is built as
[PR 687](https://github.com/usirin/tea-fabrika/pull/687): each program and its window scripts ride
inside the brain, and the local bar did not get worse ([experiment 241](../../experiments/241-one-file-build.md)).
→ next: P15, P17b, P18 to P20, P23 to
P25, P27a and P36 have tests on their branches and wait for builds; P28's tests are in, and its
build waits on P19, P21 and P26. Ticket 331 names both P24 and P28, a clash to fix
([P24's row](./tier-1.md#the-pull-requests-one-at-a-time)).
P34c, new on 2026-11-09 ([0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)),
turns P34 into OTP's top-level supervisor. *It said: its plan is drafted and waits on the owner's
read; see 2026-11-11 above.*
*2026-11-10:* the owner added P38 to Tier 1, the foundation for loading settings, so Tier 1 has
39 rows ([0069](../../.decisions/0069-choices-are-settings.md)). *It said: its plan and ticket are
to come; see 2026-11-11 above.*
*2026-11-10:* all six core ideas get their thin slice in Tier 1
([0088](../../.decisions/0088-six-slices-in-tier-1.md)), so P39 to P42 were added, to be planned,
and Tier 1 has 43 rows.
*2026-11-10:* P34 now runs on the Worker path too (ticket 402,
[PR 760](https://github.com/usirin/tea-fabrika/pull/760)): the local instance saves delivery counts,
writes `dead` and restarts a crashed program, which PR 535 had proved on Node only.
*2026-11-10:* libfabrika's files move into rooms (ticket 477,
[0043](../../.decisions/0043-rooms-on-floors.md) and [0051](../../.decisions/0051-gateway-connection-and-node-by-job.md)).
PR 0's exam landed ([PR 732](https://github.com/usirin/tea-fabrika/pull/732)), and PR 1 gives the shared names
`ProcessId`, `Sql` and `Rev` files of their own ([PR 773](https://github.com/usirin/tea-fabrika/pull/773)).
→ next: one move PR (every file to its room, then floors and fronts, then 0051's renames), then
the runner and gateway splits side by side, then the error PRs.
Its first open question is answered
([0018](../../.decisions/0018-one-application-per-program.md)): each program is its own OTP
application, so one program past its restart limit stops alone. Isolation gets hard walls
([0020](../../.decisions/0020-programs-get-hard-walls.md)): quotas per program, each program's
supervisor in its own object, and a CPU limit per isolate, all in P34c's plan.

*2026-11-10:* P8, the notes small exam, is in (ticket 274): saved notes letters frozen in
`fixtures/next/notes-letters.jsonl`, and the notes, drawing, agent and bytes laws that P13, P22 and P25
must pass. 55 run green now; 25 wait, marked `not built`, until those rows add their code. → P13's
build can start.

`next/` naming sweep, ticket 688 (2026-11-11): libfabrika's folders are modules and their ranks
are layers ([0091](../../.decisions/0091-modules-and-layers.md)). Each row of `layer-rules.json`
says `layer` where it said `floor`, with the same twelve ranks; the lint rule `fabrika/rooms` is
`fabrika/modules`, with the same checks; and oxlint's `eslint/id-denylist` keeps the old words out
of names in `next/`. No import permission, rank or runtime behavior changes, and no Tier 1 row is
done by it.

`next/` naming sweep, ticket 337 (2026-11-09): product fields, saved JSON, deletion SQL,
RPC replies and span keys now say `reason`; ledger event types and write payloads say `Event`
and `event`. Reason values, tags, streams, ids and clocks stay the same. The new
`fabrika/no-why-key` rule checks declarations in `next/`, tests included. Use fresh isolated lab
storage for these saved shapes; this change does not migrate old lab stores. Today's version
keeps `why`. → lands once its steps pass

Today's hand-run tooling, ticket 318: [review, cleanup and saved waits](../direction/hand-run-review-and-cleanup.md)
is decided 2026-11-08. Review sweeps every law and decided note and answers once. Drivers save
waits and end; lead starts fresh drivers when the saved fact holds. After merge, catch-up keeps
the checked head in MAIN and removes safe working copies. Only the lead session signs plans.

Dated 2026-11-05. **Today's pipeline is paused, and `next/` starts now, by hand (owner,
2026-11-05; [the steps](../direction/next-is-a-pipeline-pre-run.md)).** No merged pull request has been built by the pipeline yet. Since 2026-11-02,
self-fix PR 10 ([322](https://github.com/usirin/tea-fabrika/pull/322)) and PR 11a
([345](https://github.com/usirin/tea-fabrika/pull/345)) landed, ticket 117's rule changes
landed ([313](https://github.com/usirin/tea-fabrika/pull/313)), and an agent's own tile and
`line` landed ([381](https://github.com/usirin/tea-fabrika/pull/381)). Ticket 117 then stopped
twice at the test writer on a box temp folder bug; its fix,
[394](https://github.com/usirin/tea-fabrika/pull/394), landed late 2026-11-05. Tier 1 started the same day: P1 and P2, the exam
([402](https://github.com/usirin/tea-fabrika/pull/402), [401](https://github.com/usirin/tea-fabrika/pull/401)),
landed, and P3 and P4, the two spikes, answered yes
([398](https://github.com/usirin/tea-fabrika/pull/398), [399](https://github.com/usirin/tea-fabrika/pull/399);
[the split](./tier-1.md#the-pull-requests-one-at-a-time)). Each line is about
today's version unless it says `next/`. The arrow says who has the next move.

**Product foundations are built now, not after ticket 117 (owner, 2026-11-03).** Decided notes
for today's app (tile guidelines and pipe colors, the design package and typography, themes,
keybindings, the inbox, the move to Manti) go to plan and build in parallel with the pipeline
work, so what is wrong shows early. Every "after ticket 117" below that holds one of them back no
longer holds. A plan that only builds a decided note is approved by the lead agent; one that
raises a new design call goes to the owner. When the lead fills agent slots, these lanes count as
much as `next/` work and run beside Tier 1, never held back for it (owner, 2026-11-10,
[0063](../../.decisions/0063-todays-app-lanes-share-the-slots.md)).

- **Configurable keys on today's app, ticket 174.** Two pull requests. Keys PR 1, change your keys without leaving the app, merged 2026-11-08 ([PR 505](https://github.com/usirin/tea-fabrika/pull/505)). Keys PR 2 brings program and mode keys into the same table. → the lead agent plans PR 2
- **Design foundations on today's app, approved by the owner 2026-11-07.** [The build plan](./design-foundations.md): ticket 245, three pull requests, all merged 2026-11-08 ([499](https://github.com/usirin/tea-fabrika/pull/499), [506](https://github.com/usirin/tea-fabrika/pull/506), [519](https://github.com/usirin/tea-fabrika/pull/519)). → nothing

- **Pipeline v0.** Built and merged ([259](https://github.com/usirin/tea-fabrika/pull/259), [260](https://github.com/usirin/tea-fabrika/pull/260), [264](https://github.com/usirin/tea-fabrika/pull/264)). Two rehearsals on a throwaway repo, then ticket 117 (below). → the self-fix plan
- **[PR 267](https://github.com/usirin/tea-fabrika/pull/267), real answers.** Merged 2026-11-01. Its leftovers are ticket 125. → nothing
- **First real run, ticket 117.** Ran, and ended `stuck:step_stuck` at the mutation step: one stale test outside the exam (`tsh.test.ts` still expects `takes("map")` to be `[]`) made the suite red. The builder's own checks had died in its Codex box (`spawnSync git EPERM`) and it still said `done`; nothing in code checks a build before `done`, every `stuck` ends the lane, and no test output was kept. Its working copy `lane/117` is still on the machine; nothing was pushed, and the claim is released. → PRs 1, 3, 4, 5 and 7 of [the self-fix plan](./pipeline-self-fix.md) landed, and ticket 117 restarted; it is saved at `exam_merge` until PR 10 lands, and pauses at any hole PR 11 fixes until that lands too (owner, 2026-11-03). It was planned before PR 7, so its plan's properties, interface and gaps are not in the ledger. It reruns plan, the owner's yes, the test writer and build on a fresh branch from main, and the old build is kept under a ref (owner's yes 2026-11-02, on the walk of [311](https://github.com/usirin/tea-fabrika/pull/311)). *Since:* PR 10 landed 2026-11-03 and its rule changes on 2026-11-04 ([313](https://github.com/usirin/tea-fabrika/pull/313)); it then stopped at the test writer twice with `bad_report`, since `git init` could not write into `.git/hooks` inside the box. The fix, [394](https://github.com/usirin/tea-fabrika/pull/394), landed late 2026-11-05. → paused with the pipeline (owner, 2026-11-05), saved at its ask with tickets 213 and 159
- **The lane fixes itself, and a stuck lane restarts.** Decided 2026-11-01 ([jidoka and andon](../direction/jidoka-and-andon.md)): a person is asked only for a judgment, and a stuck or crashed lane restarts from the step that broke. The "after ticket 117" deferral is over. [The plan](./pipeline-self-fix.md) was nine by-hand pull requests, about 5 to 7 agent hours at the measured full-lane rate of 600 lines an agent hour (2 to 2.5 at this repo's 1,660), 4 to 5.5 of them before ticket 117 restarts ([agent hours](../direction/agent-hours.md), restated 2026-11-01; *old guess, wrong: 29 to 41.5, 22.5 to 32 before the restart*), with the rebase on restart from tracker ticket 130. It follows [the pipeline guidelines](../direction/pipeline-guidelines.md) ([PR 290](https://github.com/usirin/tea-fabrika/pull/290)): a restart that cannot prove a field goes back only to the step that writes it, every stop and every pick says where the lane goes on, a person's `stop` is a saved pause, a person may steer by a plain comment, red goes back by default, and the lane records wide from its first pull request. → approved 2026-11-01. Merged 2026-11-02: PR 1 ([301](https://github.com/usirin/tea-fabrika/pull/301)), PR 2 ([298](https://github.com/usirin/tea-fabrika/pull/298)) and PR 7 ([302](https://github.com/usirin/tea-fabrika/pull/302)). PR 3 merged 2026-11-02 ([304](https://github.com/usirin/tea-fabrika/pull/304)). PR 4 ([310](https://github.com/usirin/tea-fabrika/pull/310)) and PR 5 ([311](https://github.com/usirin/tea-fabrika/pull/311)) merged 2026-11-02. Ticket 117 restarted 2026-11-02 and is saved at `exam_merge`, where its exam pull request showed new holes. PRs 10 (the exam pull request, and a yes binds to the diff) and 11 (a route for every outcome, from [experiment 193](../../experiments/193-lane-holes.md)) build every row of the jidoka table still open, about 6 to 8 more agent hours. It restarts again once PR 10 lands, without waiting for PR 11 (owner, 2026-11-03). PR 10 merged 2026-11-03 ([322](https://github.com/usirin/tea-fabrika/pull/322)) and PR 11a, the routes and their law, 2026-11-04 ([345](https://github.com/usirin/tea-fabrika/pull/345)). PR 11b, waits and records, is not built. → paused with the pipeline (owner, 2026-11-05)
- **Tier 1 for `next/`, built now by hand.** What it builds was approved by the owner 2026-11-01. Refreshed 2026-11-05 and 2026-11-06: [36 small pull requests](./tier-1.md#the-pull-requests-one-at-a-time), 37 since 2026-11-07, in 15 waves, about 27.7 to 41.8 agent hours by their own sizes (sure 45%), against the approved 17 to 24 that left out hot reload, keys, the exams and the spikes (*old guess, wrong: 63 to 92*). P1 to P4 are done: [the exam on main](./tier-1.md#the-exam-on-main), and the browser key and the Mac app's four unknowns all answered yes. P5 is done for the sheet ([PR 404](https://github.com/usirin/tea-fabrika/pull/404)). The owner's calls of 2026-11-05 are in: one bundler, Rolldown, from P12; tea's own hook is already installed, and P30 only removes the old exam allowance, with no release wait; the first method is `initialize`; a key per client and never GitHub as a way in; an entry's clocks are `arrivedAt` and `sentAt`; `cause` on the entry in P6; a tracker ticket per pull request; P14 imports the design package, which P31 builds first in today's version; and a unit of work is a commit: each exam change is the test writer's commit inside its build pull request, and P32 builds the check that walks the commits and verifies each step's own signing key; edges are opt-in comments at the line, which P35 builds; squash merges stay, with each step's signed link from tree to tree. The owner's calls of 2026-11-06, after an audit: Tier 1 builds a slice of coordination's C2 to C5 (P33, P34, a brain restart in P12 and P19); a wake that fails on a saved letter is a crash like any other, restarted with backoff inside the budget and `down` only at the brake, with every letter kept (changed owner, 2026-11-08, following [OTP's supervisor restart intensity](https://www.erlang.org/doc/system/sup_princ.html)); *amended 2026-11-09 (owner, [0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)): restarted at once, and past the brake `failed` until a person restarts it*; every device the person owns is a master and an equal root, built in P9 and P10; a sheet belongs to the person; email recovery is decided and P36 builds it. The owner's calls of 2026-11-07: full monitoring from Tier 1, and "nothing is lost" is a Tier 1 goal ([monitoring is in Tier 1](./tier-1.md#monitoring-is-in-tier-1)). P37, the span sink, lands after P6 and before P10 and P11, and writes each process's spans to a thin JobRecord, kept forever; health keeps raw rows about 2 weeks and hourly summaries forever; `dead` keeps error classes, `down` gains `until`, and a failed Cmd comes back as a letter with a `why`; chaos proves it with p91; every plan lists what its piece records; and one alarm per object. The notes of 2026-11-03 to 2026-11-05 change little ([the list](./tier-1.md#what-the-notes-of-2026-11-03-to-2026-11-05-change)). The planner gap and how `next/` reaches the lane no longer block anything. Later tiers stay proposed. → where it stands is in the first paragraph of this section; the owner answers [questions 14 to 17 and 19](./tier-1.md#open-questions) before the pull requests that need them
- **P33, processes, is built (2026-11-08, ticket 252), merged as [PR 507](https://github.com/usirin/tea-fabrika/pull/507).** Each start is a new process with its own ID, a name is reserved for good, a monitor gets one `DOWN` for its exact recipient, `demonitor` drops a queued one, an exit and its `DOWN`s land in one transaction, and who is online is worked out from pings, never written. Review sent it back three times for the same hole, a client writing what only the brain should; one rule closed it: only the brain writes `processes/` and signal ids, an inbox read never fails, and client text is capped at 256 characters ([field note 2026-11-08-01](../../field/notes.jsonl)). [As built](./tier-1-detail.md#processes-as-p33-built-it). [Experiment 231](../../experiments/231-process-wakes.md) found a woken object cannot tell sleep from a crash by its constructor; a saved marker can, if P11 calls `storage.sync()` after writing it. What it cannot tell us yet: the cost on workerd (P12), real cloud hibernation (P24), whether P11 writes the marker at the right point, and whether P34's restart policy recovers. → nothing; P11 and P34 built on it
- **P11, programs, is built (2026-11-08, ticket 255), merged as [PR 508](https://github.com/usirin/tea-fabrika/pull/508).** A program is a pure tea machine with its declarations; the runner steps a fresh input first, appends it through P10's checked writer, and only then shows the view and runs its Cmds, each saved before it runs and answered as a letter with its `why`. Saved state climbs named upgrades, and `syncTest` and `senderTest` are in libfabrika's test kit. The runner writes the `stepping` marker and calls `storage.sync()` before each step, as [experiment 231](../../experiments/231-process-wakes.md) asked. Review sent it back twice; the rulings are in [as built](./tier-1-detail.md#programs-as-p11-built-it). Left for later: no wake reads the marker yet, a `DOWN` never reaches a program, and Cmds from mail run only at the next load (P34). What it cannot tell us yet: any cost on workerd (P12). → nothing; P12 and P34 built on it
- **The project window's build plan is approved (owner, 2026-11-09, ticket 276),** as written: a welcome page and a Cmd-O box of recent projects with Open Folder last, summon in the window's project, and no `FABRIKA_REPO`. Two pull requests: open and switch, then reopen on launch and from the Dock. The plan lands with the first one.
- **`Program.make` is built (2026-11-08, ticket 280), [PR 522](https://github.com/usirin/tea-fabrika/pull/522).** A program is one typed `Program.make` in `@kampus/libfabrika`, with every type from its machine ([Program.make](../direction/program-make.md), [the plan](./program-make.md)). tea's schemas come off the machine through a declaration-only patch in the shape of [demlik PR 899](https://github.com/kamp-us/demlik/pull/899); the bump to the release that has it deletes the patch. P14 builds on it. The owner's exam read of its type tests and the patch is still owed.
- **[PR 223](https://github.com/usirin/tea-fabrika/pull/223), the first slice of `next/`.** Paused since 2026-10-31. Read, not landed: each layer landed already fixed, from P6 on ([PR 459](https://github.com/usirin/tea-fabrika/pull/459)), as [the lean](./tier-1.md#still-open-how-next-reaches-the-lane) said. → nothing
- **[PR 258](https://github.com/usirin/tea-fabrika/pull/258), update everything.** Effect 4.1.1, pnpm 12. Merged 2026-11-01.
- **Test windows.** Merged: [257](https://github.com/usirin/tea-fabrika/pull/257) made them see-through, then [271](https://github.com/usirin/tea-fabrika/pull/271) made them show again, without focus. → nothing
- **App icon and top bar.** Merged ([274](https://github.com/usirin/tea-fabrika/pull/274), [275](https://github.com/usirin/tea-fabrika/pull/275)). → nothing
- **Window fixes, tracker tickets 141, 142 and 143.** 141 removes the `runs` program, so `trace` becomes the ticket's view; it now also holds tickets 84, 86 and 126. 142 brings Manti's ScrollArea scrollbars to the ticket and trace tiles. 143 fixes info mode (C-b i): visible words on the bottom line, `role=status`, and Escape leaves it. 143 merged 2026-11-02 ([PR 307](https://github.com/usirin/tea-fabrika/pull/307)). 141 is in build: `trace --ticket N` shows every lane of a ticket, and `tracker | trace` replaces `tracker | runs`. 142 is filed, not built. → pull requests through the pipeline, after ticket 117
- **[PR 192](https://github.com/usirin/tea-fabrika/pull/192), `claude` and `codex` as programs.** Closed 2026-11-01. Its write-up and lessons landed in [PR 303](https://github.com/usirin/tea-fabrika/pull/303); the code stays on its branch, to be rethought when a chat window needs it (Tier 5). → nothing
- **Pipe colors and tiles.** The rules are decided ([pipe colors](../direction/pipe-colors.md), [color principles](../direction/color-principles.md), [tile guidelines](../direction/tile-guidelines.md)), not built. The build is ticket 124. → a pull request through the pipeline, after ticket 117
- **Studies walked 2026-11-02.** The React tryout ([experiment 194](https://github.com/usirin/tea-fabrika/pull/320) carries it), [the DeepSeek repo](../../experiments/185-dsh-superagent-study.md) (its calls are in its "Since this was written"), [Windows](../direction/windows-in-next.md) (words decided). Themes was already decided ([themes](../direction/themes.md)). → the owner, only for who uses Windows daily
- **Shared tiles and talking to agents, walked 2026-11-04.** [Experiment 209](../../experiments/209-talking-to-agents-in-place.md) and five proposed notes: [shared tiles](../direction/shared-tiles.md), [inputs carry their sender](../direction/inputs-carry-their-sender.md), [talk where you work](../direction/talk-where-you-work.md), [principles](../direction/principles.md) and [pipeline strategies](../direction/pipeline-strategies.md), plus a [design language](../direction/design-language.md) draft. Decided in the walk: one kind of tile with agents summoned into it, and the direction that inputs carry their sender and writes their cause. [PR 381](https://github.com/usirin/tea-fabrika/pull/381) (an agent's own tile, and the `line` tool) is planned to land as it is (the lead agent's call), so ticket 117 can start through `line`; the shared tile replaces its own-tile kind after, and [PR 383](https://github.com/usirin/tea-fabrika/pull/383)'s hidden controls go. → the owner settles the proposed parts; then a build plan for today's version, envelope recording first
- **Two pieces of `next/` work this study asks for (proposed, the lead's recommendation).** (1) `next/src/data/log.ts`'s `Entry` has `at`, `by` and `said` (now `arrivedAt`, `by` and `sentAt`) but no `cause`: add it now, since an entry written without it never gets it back. (2) "A spot", a way for any program to name a thing on its screen, needs a design before talking at a spot can work. → (1) decided by the owner 2026-11-05: `cause` lands in P6, and the rest of the note lands in P10 and P11 ([Tier 1's question 11](./tier-1.md#open-questions)). (2) got its shape on 2026-11-05 ([PR 403](https://github.com/usirin/tea-fabrika/pull/403)): a program's `location` plus the version it came from, written for both versions; no Tier 1 row touches it
- **Effect on Cloudflare, [experiment 174](../../experiments/174-effect-on-cloudflare.md).** Walked 2026-11-02, two rulings. [tea is the engine](../direction/tea-is-the-engine.md): no Effect `Workflow`, cluster not now. Tier 1 takes its one change: a wait is data on the socket, and a waiting tab stops knocking every 5 s ([Tier 1, Cloudflare](./tier-1-detail.md#cloudflare)). → nothing
- **demlik.** Epics landed, no release yet. The three issues that waited have rulings as of 2026-11-01: [756](https://github.com/kamp-us/demlik/issues/756#issuecomment-6564399911), [782](https://github.com/kamp-us/demlik/issues/782#issuecomment-6564266885) and [777](https://github.com/kamp-us/demlik/issues/777#issuecomment-6564371162). → demlik's agents build them, and the release stays the owner's call
- **Copying for the app and Tuval in `next/`.** Settled: rethink stays the default, with copies only where the owner names them. Tier 1 names three (styling, `programs/markdown`, the MCP tools; [Tier 1](./tier-1.md)). Tier 2's named copies come with its plan. → nothing now
- **People before agents in `next/`.** Settled by [the tier order](./tiers.md): a few people is Tier 3 (it said two people until the owner widened it, 2026-11-07), agents Tier 5. → nothing
- **Conversation branches.** Saved, not designed. → when the agents tier is next
- **Left for later.** The third step of going through the two trackers with the owner, and whether popovers use the browser's own `<dialog>` or a library.

## What to read for your job

| Your job | Read |
|---|---|
| Fix today's version | [AGENTS.md](../../AGENTS.md), the [package list](../../README.md#what-is-in-this-repository), then that part's own README |
| Build in `next/` | [Tier 1](./tier-1.md), [its pull requests and waves](./tier-1.md#the-pull-requests-one-at-a-time) and [ticket 115's plan](./ticket-115.md), [the steps](../direction/next-is-a-pipeline-pre-run.md), the [Start here list](../direction/README.md#start-here). No builder starts before an approved plan and tests that exist |
| Run a real ticket | [Run a ticket through the pipeline](../how-to/run-a-pipeline-ticket.md), [AGENTS.md's rules](../../AGENTS.md#running-the-machine-on-a-real-ticket), then [field/](../../field/README.md) for what past runs hit |
| Write down a decision | A note in [docs/direction](../direction/README.md), the same day, plus its row. Mark it **proposed** until it is settled |
| Log a run | [field/README.md](../../field/README.md) for the schema: one row per agent run, one note per thing that broke, cost too much, needed a person or worked well |

## Who decides what

**Only the owner:**

- Approves a plan that raises a new design call, in `next/` or today's, before any builder starts. A plan that only builds a decided note is approved by the lead agent (owner, 2026-11-03; [AGENTS.md](../../AGENTS.md#two-versions-side-by-side)).
- Approves a pull request on GitHub, and answers a question the machine put to a person. No agent does either. A merge does not wait on that yes: see [how a change lands](#how-a-change-lands).
- *Changed 2026-11-05:* how `next/` reaches the lane no longer needs an answer before Tier 1 starts ([why](./tier-1.md#still-open-how-next-reaches-the-lane)). *It said: answers it before PR A's plan step (lean 65%).*
- Settles a **proposed** note.
- Reads each exam pull request. On today's lane, since [the self-fix plan](./pipeline-self-fix.md)'s PR 5 landed, a builder's diff to the exam files asks the owner, with two picks: the builder was wrong (the touched files go back, and build runs again on the builder's head) or the test is wrong (the test writer redoes those files with the owner's note). Either way every finished step is kept.
- Adds an entry to `unreachable-ledger.json`, in a change of its own.
- Says yes after reading `alchemy plan`, before a deploy to the cloud.
- Names each exception to "never copy across".
- Picks a side where Tuval or tmux clash with how Linear would build a screen.

**An agent, alone:**

- Decides which version a job is in when the brief says, or the rule in [AGENTS.md](../../AGENTS.md#two-versions-side-by-side) answers it. If it still cannot tell, it asks.
- Writes a note marked **proposed**, an experiment, or a field log.
- Splits Tier 1 by hand, once, as a named exception: done 2026-11-05 as [29 pull requests](./tier-1.md#the-pull-requests-one-at-a-time), and grown to 36: P30 for tea's own hook, P31 for the design package and P32 for the commit check (2026-11-05), then P33 and P34 for coordination's slice, P35 for the edges exam and P36 for email recovery (2026-11-06). Each row also gets a ticket in today's tracker, filed by the lead agent when its plan starts, with `from` pointing at Tier 1's plan (owner, 2026-11-05, [question 12](./tier-1.md#open-questions)). No second project gets split by hand without the owner's yes. *It said: files Tier 1's ticket after ticket 117 lands, and each task of the planner's plan as a ticket.*
- Fixes a dead-code finding it checked by hand. If the finding is wrong, it stops and tells the owner.
- Makes calls inside an approved plan, marked as its own call, with why, cost and how sure. The owner may overturn them.
- Adds a lint exception on a line where the code is right and the rule does not fit, with the reason in plain words. It never switches a rule off to pass.

In a live run on a target repository, never, by anyone's agent: merge by hand, arm auto-merge, or push to its main. Once a lane is finished and stuck, [what is left is a by-hand change](#how-a-change-lands).

## How a change lands

- **A live run on a target repository:** inside the run, nothing but ship merges. Once a lane is finished and stuck, what is left is a by-hand change, under the next rule.
- **A pull request that went by hand:** one review by a separate agent says merge-ready, CI is green for code, and the lead agent reads the diff and runs a leak grep. Then the lead agent merges, and `catchup.sh` comments on each ticket it closes with the pull request and its merge commit (`.agents/skills/lead/scripts/catchup.sh:86`). No row per merge is written in `field/` yet: that note's M1 is proposed. A merge never waits on the owner ([autonomy is measured trust](../direction/autonomy-is-measured-trust.md), decided 2026-11-03). The lead merges product code and exam changes the same way, with `catchup.sh`, once every step passed and `loosening.sh` shows no real loosening after its hand check; only real loosening of a law, or a new design call, waits on the owner ([0014](../../.decisions/0014-the-lead-merges-when-every-step-passed.md), owner, 2026-11-09). The owner still says yes after `alchemy plan`. *It said: the owner's yes, with CI green for code.*
- **Auto-merge on a hand pull request** (owner, 2026-11-08). The repo allows auto-merge and deletes head branches on merge. A hand pull request, never a live run's, gets auto-merge armed once its checks are known to pass, e2e included. `ask owner exam_read` stays a warning, so an agent's pull request that edits the exam can merge before the owner reads it. The owner accepts that, to test the pipeline's own limits. The lead agent never writes "owner read" unless the owner did, and each such merge gets a field note, so what slipped through can be counted.
- **An exam change that is all proper property tests** (owner, 2026-11-08) merges without the owner's read. Proper means every new or changed law is a property, or an example labeled `vector:`, `format:`, `pinned:` or `scenario:` with its reason; nothing loosens. Zero hits from `loosening.sh` show that; the PR writes its removed/replacement mapping table and that output. Mutation is no step of a pull request: the hourly run against main files a narrowed law as a ticket marked loosening ([0066](../../.decisions/0066-mutation-runs-on-a-schedule.md)). *It said: mutation shows no law got narrower, with the mutation arm-a vs arm-b narrowing list as a second output.* The lead agent checks that and says so in the pull request. Measure the new check's false alarms on the last 20 merged `next/` PRs before it blocks. A change that loosens or removes a law still waits on the owner. The leak check fails closed: any hit goes to the lead agent's hand check.
- **A pull request changes at most 600 lines of product code** (owner, 2026-11-10, a trial that
  only advises until it is replayed on this repo's merged pull requests). Bigger work is a stack of
  slices the plan cuts, each its own pull request through every step, landing whole with its tests
  ([0087](../../.decisions/0087-a-pull-request-caps-product-lines.md)).
- **The tests step writes each law as a property that walks the machine** (owner, 2026-11-11, a
  trial). Its generator reads the state it folds. Each plant is run once to show the law can fail,
  recorded in the report and the run row, and not committed. A single example stays only with a
  `vector:`, `format:`, `pinned:` or `scenario:` label. A second check on another product file
  ends the trial ([0093](../../.decisions/0093-laws-walk-plants-run-once.md)).
- **A docs-only pull request that writes down a decision** (owner, 2026-11-09) is opened the turn it is decided and merged when CI is green and the leak grep is clean, with no plan, tests, review or field rows. Code pull requests keep their steps.
- **Rows that only record what happened (field logs, index rows):** they merge after the leak grep, with no yes.
- **CI wastes no time** (owner, 2026-11-09). A pull request that changes only field rows runs a seconds-long row schema check instead of the full check job, and each lane carries its own field rows. Then every CI job's time is audited for more cuts. The build is in progress (tracker ticket 342). Ticket 375 (PR A) makes skill prose skip the heavy jobs and runs only the tests a skill script reaches; ticket 376 (PR B) puts next on six machines, built 2026-11-10 as [PR 653](https://github.com/usirin/tea-fabrika/pull/653). *It said: three machines. The approved plan chose six, as the `test` job has, and split the one 248 s test file in four so no machine is held by it.*
- **Direction notes and plans:** a note that records an owner's decision, or a plan that only builds decided notes, merges as above. A new design call still gets the owner's yes ([the steps](../direction/next-is-a-pipeline-pre-run.md)). *It said: they still get the owner's yes.*
- **A pull request that changes only Markdown or images:** no CI wait when no check reads them. Shared skill instructions are read by `skillscheck.sh`, so wait for that check. A broken relative link can slip through.
- **To bring a branch up to date:** merge `main` in (`git merge origin/main`), never a rebase, a force-push or `gh pr update-branch` (GitHub makes that merge commit, so no step key signs it). In `next/`, the merge is a `lead` commit, signed like any step's ([P32](./tier-1.md#the-pull-requests-one-at-a-time)). A stacked child is the one exception: [0004](../../.decisions/0004-squash-merges-and-native-stacks.md). The commit check's up-to-date rule stays. One command merges `main` in as the bot, signs it as `lead`, and pushes the commit and its notes together, so CI starts on its own; a person's pull request gets its `lead` merge from the same command (owner, 2026-11-08). Checks still rerun on the final commit. *Changed 2026-11-07: it said "rebase and force-push with a lease, never a merge commit or `gh pr update-branch`", and that the diff's `git patch-id --stable` stays the same, so a review holds. That was wrong: it clashed with [done is per criterion](../direction/done-is-per-criterion.md) and [read fresh, run alone](../direction/read-fresh-run-alone.md), a rebase changes every tree a step signed, and a review binds to the diff by replay, not by patch-id ([a yes binds to the diff](../direction/a-yes-binds-to-the-diff.md)).*
- **Stacked work:** see [0004](../../.decisions/0004-squash-merges-and-native-stacks.md) and
  [lead](../../.agents/skills/lead/SKILL.md).
- **After every merge:** fast-forward the main checkout (`git pull --ff-only origin main`). Never reset or stash there; your own work stays in worktrees.

## Words

- **lane:** one ticket's whole trip through the steps, held by one machine.
- **step:** one stage of a lane, such as triage or build.
- **exam:** what a change is checked against: tests, laws, lint and CI rules. The builder never changes it.
- **laws:** rules a machine must keep, checked on its real reducer across many orders of messages.
- **box:** the sandbox a program or agent runs in.
- **walk:** going through something with the owner, step by step.
- **Tuval:** the codename of the desktop layer in `next/`, the package `@kampus/tuval`. Users see "fabrika".
- **demlik:** the repository [kamp-us/demlik](https://github.com/kamp-us/demlik), home of `@demlik/tea` and `@demlik/code-graph`.
- **Jev:** a small classifier that answers one narrow question, cheaper and faster than a big model.
- **brain:** in `next/`, the place programs run and the ledger lives, on a laptop or on Cloudflare.
- **hands:** in `next/`, the process on a computer that does machine work for the brain, such as git and agents.
- **ledger:** the append-only record of facts. Everything else folds from it.
- **fold:** to work a state out by reading the facts in order. For a tile, to shrink it to a thin strip.
- **slice:** one thin piece of work that goes through every layer.
- **leak grep:** a text search of a change's added lines for keys, machine paths and names, before it lands in this public repository.
- **ratchet:** a limit that only tightens.
- **tsh:** today's shell, which runs only tea programs. In `next/` the shell is `fabsh`.
- **tile:** one pane in the app's window.
- **claim:** a lane's hold on a ticket, on the ledger, so no second lane runs it.
- **pinned merge:** a merge that names the main it read, so a newer commit on main stops it.
- **`@kampus/pipeline`:** the library in `packages/pipeline`, today's stages and services.
- **`@tea-fabrika/pipeline`:** the program in `programs/pipeline`, the line a person types.

## Keeping this true

When the plan or its state changes, this file changes in the same pull request or the same
day. A stale line here costs every agent that reads it.

## What this file cannot tell us

- What changed after its date. Check the pull requests it links.
- Whether the tiers past Tier 1 hold. They are a proposal.
