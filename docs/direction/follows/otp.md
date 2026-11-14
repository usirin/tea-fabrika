# Where we follow OTP

Coordination sits where OTP sits, so it follows OTP
([C5](../a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31)). This table is about
`next/`. One row per behavior. Paths are under `next/packages/libfabrika/src/`. A pull request that
changes one of these behaviors updates its row in the same pull request
([0017](../../../.decisions/0017-each-model-we-follow-has-one-table.md)).

Seeded 2026-11-09 from [experiment 239](../../../experiments/239-supervision-vs-otp.md), checked
against main at `5b1171ed`. OTP's side is its documentation as read that day:
[supervisor behaviour][sup], [`supervisor`][supref], [processes][proc], [`erlang`][erl] and [`application`][app].

| Behavior | What OTP does | What we do | Same or differs |
|---|---|---|---|
| Register a name | `register(Name, Pid)`; a taken name fails ([proc]) | The first start writes `registered`; a taken name is `name_taken` (`processes/ProcessManager.ts:132-144`, `processes/Process.ts:243-244`) | same |
| A name on exit | "automatically unregistered if the process terminates" ([proc]) | Never freed; a restart reuses the name (`processes/Process.ts:247-257`) | differs, because a name is a stream, and the log keeps every stream (C5) |
| Find a name's process | `whereis(Name)` ([erl]) | `status(name)` reads its current process (`processes/Process.ts:274-296`) | same |
| Mailbox lifetime | In memory, gone with the process ([proc]) | `<name>/inbox` on the ledger, read again after a restart (`processes/ProcessManager.ts:279-300`) | differs, because delivery is at least once (C2) |
| Mailbox order | Kept per sender and receiver ([proc]) | One total order per inbox, by `rev` (`processes/ProcessManager.ts:288`) | same, and stronger |
| Send to another process | `Pid ! Msg` is asynchronous: it puts the message in the receiver's mailbox and returns, and the receiver takes it on its own turn ([proc]) | A Send saves the letter in the target's inbox through the Project, then the target's `mailed` only sets its one alarm; the alarm's turn steps the letter, also when the two are separate objects (`cloudflare/mail.ts:29-44`, `runtime/Runner.ts:1329-1337`) | same |
| Selective receive | `receive` takes the first match and leaves the rest ([proc]) | None: every letter reaches `update` in inbox order (`runtime/Program.ts:506-515`) | differs, because one `update` takes every Msg, as in Elm (C5) |
| A letter that always crashes | Nothing built in; the restart drops the mailbox | Counted per letter (`runtime/internal/recovery.ts:70-84`); at the limit, `<pid>/dead` and `refused {why: "dead"}` (`runtime/Runner.ts:515-531`) | differs, because a durable inbox would replay it forever (C2) |
| A new pid per start | A restart is a new pid ([sup]) | A new `process_<26>` each start, with `restarted {after}` (`processes/ProcessManager.ts:125`, `:157-171`) | same |
| Start a child by name | `whereis`, then `supervisor:start_child(Sup, Spec)`; a running name answers `{error, {already_started, Pid}}`, a known one not running `{error, already_present}`, each read from the child list at the call ([supref]) | `Children.start` reads the saved start, the requester, the grant and whereis in one ledger turn, then writes `registered`, `started {requester}` and the first letter in one turn (`processes/ChildrenLedger.ts`); a program asks with the built-in `start_child` (`runtime/StartChild.ts`) | same, and adds a start id: a saved start answers its `started` again, so a lost answer is found; both "already" answers are success cases, since the caller acts on them |
| A child that finishes | A worker returns `{stop, normal, State}`; a `transient` or `temporary` child is not restarted ([sup], [gensrv], not read for this row) | The built-in `exit` writes `exited {reason: normal}` after the Cmds listed before it in its step; none after it runs, no later letter is stepped, and nothing restarts it (`runtime/Runner.ts`) | same |
| A parent and child reach each other | The parent holds the child's pid from `start_child`; the child gets its parent's from `proc_lib` ([supref]) | Mail between a child and the program that started it needs no host grant, read by registered name from the child's first `started` line (`processes/ProgramMailLedger.ts`, `processes/Process.ts`) | differs, because a name survives a restart here, so a restarted parent keeps the right; nobody else gains one |
| Links | Two-way; an exit signal ends the other side ([proc]) | Not built, Tier 4 ([tier 1](../../plan/tier-1.md), "Coordination past Tier 1's slice") | differs, because nothing needs them yet: a child outlives the process that started it |
| Trap exit | A trapping process gets `{'EXIT', From, Reason}` ([proc]) | Not built, Tier 4 | differs, because it needs links first |
| Exit reasons | `normal`, `shutdown`, `{shutdown, T}`, `kill` decide what happens ([proc]) | `exited {why}`, any text up to 256 characters (`processes/internal/processTable.ts:13`, `:47`) | differs, because nothing reads a reason yet; no reason is written for keeping it free text (ticket 406) |
| Who may end a process | Anyone with the pid (`exit_signal/2`, [erl]) | Only the name's owner (`processes/Process.ts:313-326`) | differs, because a job cannot kill a job it does not own (C5) |
| Monitor | One-way; one `DOWN` when it ends ([proc]) | A `monitored` fact, one `DOWN` per live watch, written with `exited` (`processes/ProcessManager.ts:182-214`) | same |
| `DOWN`'s shape | `{'DOWN', Ref, process, Pid, Reason}` ([proc]) | `{_tag: "DOWN", ref, process, why, to}` (`processes/Process.ts:62-67`) | differs, because a restart keeps the name, so a `DOWN` for an old life must not reach the new one (C4) |
| Monitor a gone process | `DOWN` at once, with `noproc` ([proc]) | The same (`processes/ProcessManager.ts:233-242`) | same |
| A watcher ends | Its monitors go ([proc]) | Each of its watches gets `demonitored {why: "watcher_exited"}` (`processes/ProcessManager.ts:199-211`) | same |
| demonitor | Keeps a queued `DOWN` unless `[flush]` ([erl]) | Always drops it (`processes/Process.ts:417-419`) | differs, because a canceled watch's `DOWN` serves nobody (C5) |
| Signals | Separate from messages ([proc]) | A `DOWN` is a letter under a signal id only the brain writes (`processes/Process.ts:49-56`, `:393-420`) | differs, because a browser has no pid and reads one durable stream (C5) |
| Mail outside the program's API | `handle_info` receives messages outside `handle_call` and `handle_cast` ([server]) | The brain appends a letter under `noticeId(key)` with `letterLine`. Fresh notices take `step` without an input port; accepted notices fold on replay. Client entry points refuse notice ids (`processes/Process.ts:196`, `runtime/Runner.ts:978`, `access/SessionManager.ts:132`) | same role; differs because ids are brain-only and refused or throwing notices are skipped with a span count (P45 slice 1) |
| Who supervises | A supervisor process, linked to its children ([sup]) | A tea machine (`runtime/internal/supervisor.ts:59`) stepped inside the program's own object (`runtime/Runner.ts:310-431`) | differs, because its receipts sit beside the step in the object's SQLite (C5) |
| Strategies | `one_for_one`, `one_for_all`, `rest_for_one`, `simple_one_for_one` ([sup]) | `one_for_one` with one child; the rest not built, Tier 4 | differs, because Tier 1 has one child |
| Restart types | `permanent`, `transient`, `temporary` ([sup]) | In effect `transient`: only a throw restarts (`runtime/internal/supervisor.ts:84-131`), never a normal `exit`; no choice yet, Tier 4 | differs, because no program declares a restart type yet; P34c reads it from the declaration |
| A child that fails during start | `start_link` fails: the supervisor "first terminates all already started child processes with reason `shutdown` and then terminate itself", and restart strategies apply to children that started ([supref], read 2026-11-10) | The local stage's brain (workerd): if it dies before the stage's ready line, `startDev` fails with a `ControlError` and no replacement is started (`node/dev/dev.ts:322-334`, `next/apps/fabrika/dev.ts:81-84`); restarts and the brake apply after it (`node/dev/dev.ts:286-318`) | same; [0044](../../../.decisions/0044-a-brain-that-dies-starting-fails.md) writes it down, and no law checks the "no replacement" half yet (ticket 512) |
| A start's answer | `gen_server:start_link` returns after the new process's `init/1` has run; work for after the start goes in `handle_continue` ([gen_server]) | A first start answers once the object's `configure` has saved the descriptor and run `ProgramRunner.init`, which loads the program and arms its alarm (`cloudflare/runtime.ts`, `configureProcess`); a start made during the Project's own build is delivered after that build, forked into its scope, as `handle_continue` | same; ticket 762 (A2), since a new process's `init` asks the Project for its status, and the build may not wait on that call |
| Restart intensity | The supervisor's `init/1` callback supplies intensity and period; 1 in 5 s by default; more than MaxR in MaxT gives up ([supref]) | A new recovery journal uses the program's checked `policy`, else trusted wiring, else `defaultPolicy`, 5 in 5,000 ms. Existing journals keep their policy and counts (`runtime/Program.ts:133`, `runtime/Runner.ts:539-575`), with the edge counted (`processes/Process.ts:129-130`). P34c's replacement remains decided below. | differs, because intensity must be at least the delivery limit, or a bad letter trips the brake before it is dead (`runtime/internal/recovery.ts:19`) |
| Restart backoff | None: OTP restarts at once ([sup]) | 100 ms doubling to 800 ms, reset after 5 s live (`runtime/internal/supervisor.ts:11`, `:103-107`, `:147-149`) | differs, because a restart here is a wake, writes and a load ([experiment 100](../../../experiments/100-supervision-tree.md)) |
| Past the limit | Ends its children and itself with `shutdown`; the parent decides ([sup]) | `down {why, crashes, until}`, then a new start at `until`, forever (`runtime/internal/supervisor.ts:116-136`) | differs, because Tier 1 has no parent (C4); about 276,000 entries a day for a program that always throws; 0016 closes it |
| Applications | A node runs many applications, each with its own top-level supervisor ([sup]); a `temporary` one that stops "is reported but no other applications are terminated" ([app]) | No applications yet; each program's supervisor sits in its own object (`runtime/internal/supervisor.ts:59`, `runtime/Runner.ts:310-431`), so one name's crash loop touches no other name | same in effect; [0018](../../../.decisions/0018-one-application-per-program.md) makes it explicit: one application per program, and no program's failure may stop another |
| Shutdown | `brutal_kill`, a timeout or `infinity`; reverse start order ([sup]) | Exit is at once (`processes/ProcessManager.ts:182-214`); later writes are refused (`gateway/Gateway.ts:1350`, `:1356`) | differs, because steps are serial (`runtime/Runner.ts:224`), so nothing is half-written (C5) |
| A busy process | The scheduler preempts each process after a count of reductions, so one busy loop cannot stall the others ([proc]) | Each process runs in its own Worker Loader isolate (`cloudflare/index.ts:25`), but `limits.cpuMs` is unset and a local workerd runs them on one thread: a 300 ms spin stalls every process ([experiment 173](../../../experiments/173-worker-loader.md)) | differs, because nothing caps a step yet; [0020](../../../.decisions/0020-programs-get-hard-walls.md) sets `cpuMs` from a measured step and a local step watchdog, built by P34c |
| A state's timeout | `gen_statem`'s state timeout: a named state sets a timer, and when it fires a message arrives in that state; leaving the state cancels it ([statem]) | The merger's `waiting` step holds the time, `wake(model)` gives it to the runner, and the runner saves it as the object's one alarm and sends `timer` when it is due; a `timer` from a wait the merger has left changes nothing (`next/programs/pipeline/src/Merger.ts:347`, `runtime/Runner.ts:186`) | differs, because the alarm is saved, so the wait is still there after a restart ([0105](../../../.decisions/0105-a-durable-object-never-stays-awake-on-its-own.md)); OTP's timer is in memory and goes with the process |
| View watchers across sleep | Hibernation keeps callback state and process identity ([gen_server], [erl]) | `runtime/WatchersSql.ts` saves membership in the Process object's database; the next runner loads it without another open | same lifetime; differs in storage because JavaScript memory is discarded |
| View watcher leaves | A process monitor receives `DOWN` on termination ([proc]); browser view clients have no OTP pid | `cloudflare/Publish.ts` returns gone for a missing Project route; `runtime/WatchersSql.ts` removes that watch on the next publish | differs: lazy view membership cleanup, separate from process monitors; unknown failures retain membership |

Count: 37 rows, 13 same, 24 differ. Of the 24, 4 are not built yet (links, trap exit, three of the
four strategies, restart types), each waiting for Tier 4. One has no written reason yet: exit
reasons (ticket 406). One is an open call: past the limit (ticket 404). One is decided and not built: a busy process (0020).

The following rows add P15 slice 1's code loading in `next/`.

| Behavior | What OTP does | What we do | Same or differs |
|---|---|---|---|
| Load new code | Keeps current and old module versions; a fully qualified call enters the current version ([code loading](https://www.erlang.org/doc/system/code_loading.html)) | Select a checked hash only after folding `code.loaded`, then push it to that program's live processes. A first start takes the selection under the Project's turn and keeps that choice for retries. A saved checkpoint loads its own hash (`runtime/Code.ts`, `cloudflare/runtime.ts`, `cloudflare/index.ts`) | differs: each process keeps its own isolate by hash until its swap succeeds |
| Change a live model | Suspend, call `code_change/3`, resume on success ([sys](https://www.erlang.org/doc/apps/stdlib/sys.html)) | The runner's permit holds the swap between turns. The named upgrade chain and new schema read the kept model; a refusal leaves this process on its old code. The existing supervisor saves unfinished swap work before the checkpoint and finishes its facts and whole view before another turn (`runtime/Runner.ts`, `runtime/internal/supervisor.ts`) | same purpose; a refusal is a durable `code.refused` fact |
| Restart after a code change | A restarted child calls the module's current code ([supervisor][supref]) | An idle supervisor takes `swapped` with the new build, so a later crash restarts on that build (`runtime/internal/supervisor.ts`) | same; a refused process keeps its old build |

Coming: [0016](../../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)
makes Tier 1's supervision OTP's top-level supervisor, built by P34c. The rows above say what is on
main today. [0018](../../../.decisions/0018-one-application-per-program.md) amends it: each program is its own
application with its own top-level supervisor, so one program past its limit stops alone. P34c's
pull request updates the rows for who supervises, restart types, intensity, backoff, past the
limit, applications, exit reasons and a busy process.
[0020](../../../.decisions/0020-programs-get-hard-walls.md) amends 0018: each program's supervisor
lives in its own object and learns of a crash by a letter, as OTP's supervisor learns of a death by
message, and isolation gets hard walls: quotas per program and a CPU limit per isolate.

[sup]: https://www.erlang.org/doc/system/sup_princ.html
[gen_server]: https://www.erlang.org/doc/apps/stdlib/gen_server.html
[supref]: https://www.erlang.org/doc/apps/stdlib/supervisor.html
[proc]: https://www.erlang.org/doc/system/ref_man_processes.html
[erl]: https://www.erlang.org/doc/apps/erts/erlang.html
[app]: https://www.erlang.org/doc/apps/kernel/application.html
[gensrv]: https://www.erlang.org/doc/apps/stdlib/gen_server.html
[statem]: https://www.erlang.org/doc/system/statem.html#state-time-outs
[server]: https://www.erlang.org/doc/apps/stdlib/gen_server.html#c:handle_info/2
