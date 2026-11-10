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
| Register a name | `register(Name, Pid)`; a taken name fails ([proc]) | The first start writes `registered`; a taken name is `name_taken` (`coordination/process-manager.ts:132-144`, `coordination/process.ts:322-323`) | same |
| A name on exit | "automatically unregistered if the process terminates" ([proc]) | Never freed; a restart reuses the name (`coordination/process.ts:324-327`) | differs, because a name is a stream, and the log keeps every stream (C5) |
| Find a name's process | `whereis(Name)` ([erl]) | `status(name)` reads its current process (`coordination/process.ts:337-354`) | same |
| Mailbox lifetime | In memory, gone with the process ([proc]) | `<name>/inbox` on the ledger, read again after a restart (`coordination/process-manager.ts:279-300`) | differs, because delivery is at least once (C2) |
| Mailbox order | Kept per sender and receiver ([proc]) | One total order per inbox, by `rev` (`coordination/process-manager.ts:288`) | same, and stronger |
| Selective receive | `receive` takes the first match and leaves the rest ([proc]) | None: every letter reaches `update` in inbox order (`app/program.ts:506-515`) | differs, because one `update` takes every Msg, as in Elm (C5) |
| A letter that always crashes | Nothing built in; the restart drops the mailbox | Counted per letter (`coordination/recovery.ts:70-84`); at the limit, `<pid>/dead` and `refused {why: "dead"}` (`app/runner.ts:515-531`) | differs, because a durable inbox would replay it forever (C2) |
| A new pid per start | A restart is a new pid ([sup]) | A new `process_<26>` each start, with `restarted {after}` (`coordination/process-manager.ts:125`, `:157-171`) | same |
| Links | Two-way; an exit signal ends the other side ([proc]) | Not built, Tier 4 ([tier 1](../../plan/tier-1.md), "Coordination past Tier 1's slice") | differs, because Tier 1 has no process that starts another |
| Trap exit | A trapping process gets `{'EXIT', From, Reason}` ([proc]) | Not built, Tier 4 | differs, because it needs links first |
| Exit reasons | `normal`, `shutdown`, `{shutdown, T}`, `kill` decide what happens ([proc]) | `exited {why}`, any text up to 256 characters (`coordination/process.ts:11`, `:48`) | differs, because nothing reads a reason yet; no reason is written for keeping it free text (ticket 406) |
| Who may end a process | Anyone with the pid (`exit_signal/2`, [erl]) | Only the name's owner (`coordination/process.ts:361-371`) | differs, because a job cannot kill a job it does not own (C5) |
| Monitor | One-way; one `DOWN` when it ends ([proc]) | A `monitored` fact, one `DOWN` per live watch, written with `exited` (`coordination/process-manager.ts:182-214`) | same |
| `DOWN`'s shape | `{'DOWN', Ref, process, Pid, Reason}` ([proc]) | `{_tag: "DOWN", ref, process, why, to}` (`coordination/process.ts:77-82`) | differs, because a restart keeps the name, so a `DOWN` for an old life must not reach the new one (C4) |
| Monitor a gone process | `DOWN` at once, with `noproc` ([proc]) | The same (`coordination/process-manager.ts:233-242`) | same |
| A watcher ends | Its monitors go ([proc]) | Each of its watches gets `demonitored {why: "watcher_exited"}` (`coordination/process-manager.ts:199-211`) | same |
| demonitor | Keeps a queued `DOWN` unless `[flush]` ([erl]) | Always drops it (`coordination/process.ts:423-429`) | differs, because a canceled watch's `DOWN` serves nobody (C5) |
| Signals | Separate from messages ([proc]) | A `DOWN` is a letter under a signal id only the brain writes (`coordination/process.ts:61-72`, `:415-430`) | differs, because a browser has no pid and reads one durable stream (C5) |
| Who supervises | A supervisor process, linked to its children ([sup]) | A tea machine (`app/supervisor.ts:59`) stepped inside the program's own object (`app/runner.ts:310-431`) | differs, because its receipts sit beside the step in the object's SQLite (C5) |
| Strategies | `one_for_one`, `one_for_all`, `rest_for_one`, `simple_one_for_one` ([sup]) | `one_for_one` with one child; the rest not built, Tier 4 | differs, because Tier 1 has one child |
| Restart types | `permanent`, `transient`, `temporary` ([sup]) | In effect `transient`: only a throw restarts (`app/supervisor.ts:84-131`); no choice yet, Tier 4 | differs, because a program has no normal exit in Tier 1 |
| Restart intensity | 1 in 5 s by default; more than MaxR in MaxT gives up ([supref]) | 5 in 5,000 ms by default (`app/supervisor.ts:6-11`), with the edge counted (`coordination/process.ts:127-132`) | differs, because intensity must be at least the delivery limit, or a bad letter trips the brake before it is dead (`coordination/recovery.ts:19`) |
| Restart backoff | None: OTP restarts at once ([sup]) | 100 ms doubling to 800 ms, reset after 5 s live (`app/supervisor.ts:11`, `:103-107`, `:147-149`) | differs, because a restart here is a wake, writes and a load ([experiment 100](../../../experiments/100-supervision-tree.md)) |
| Past the limit | Ends its children and itself with `shutdown`; the parent decides ([sup]) | `down {why, crashes, until}`, then a new start at `until`, forever (`app/supervisor.ts:116-136`) | differs, because Tier 1 has no parent (C4); about 276,000 entries a day for a program that always throws; 0016 closes it |
| Applications | A node runs many applications, each with its own top-level supervisor ([sup]); a `temporary` one that stops "is reported but no other applications are terminated" ([app]) | No applications yet; each program's supervisor sits in its own object (`app/supervisor.ts:59`, `app/runner.ts:310-431`), so one name's crash loop touches no other name | same in effect; [0018](../../../.decisions/0018-one-application-per-program.md) makes it explicit: one application per program, and no program's failure may stop another |
| Shutdown | `brutal_kill`, a timeout or `infinity`; reverse start order ([sup]) | Exit is at once (`coordination/process-manager.ts:182-214`); later writes are refused (`door/door.ts:1350`, `:1356`) | differs, because steps are serial (`app/runner.ts:224`), so nothing is half-written (C5) |
| A busy process | The scheduler preempts each process after a count of reductions, so one busy loop cannot stall the others ([proc]) | Each process runs in its own Worker Loader isolate (`workers/index.ts:25`), but `limits.cpuMs` is unset and a local workerd runs them on one thread: a 300 ms spin stalls every process ([experiment 173](../../../experiments/173-worker-loader.md)) | differs, because nothing caps a step yet; [0020](../../../.decisions/0020-programs-get-hard-walls.md) sets `cpuMs` from a measured step and a local step watchdog, built by P34c |

Count: 27 rows, 8 same, 19 differ. Of the 19, 4 are not built yet (links, trap exit, three of the
four strategies, restart types), each waiting for Tier 4. One has no written reason yet: exit
reasons (ticket 406). One is an open call: past the limit (ticket 404). One is decided and not built: a busy process (0020).

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
[supref]: https://www.erlang.org/doc/apps/stdlib/supervisor.html
[proc]: https://www.erlang.org/doc/system/ref_man_processes.html
[erl]: https://www.erlang.org/doc/apps/erts/erlang.html
[app]: https://www.erlang.org/doc/apps/kernel/application.html
