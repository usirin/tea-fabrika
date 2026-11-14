---
date: "2026-11-09"
scripts: "none"
summary: "`next/`, P33 and P34, reading against OTP's own docs, not a measurement: C5's owed check. Of 24 OTP features, 7 are the same, 12 differ, 1 is added (dead letters) and 4 are missing (links, trap exit, three strategies, restart types), each missing one deferred to Tier 4 with its reason. 6 differences have no written reason: five need one line in C5 (ticket 405), and `exited`'s free-text reason loses OTP's normal, shutdown and kill (ticket 406, 65%). Past the brake a name never gives up: arithmetic from the defaults gives about one restart a second, about 276,000 ledger entries a day for one always-throwing program; lean: a wait that grows like Kubernetes', 70%, the owner's call (ticket 404). Supervision is not on on the Worker path yet (`workers/runtime.ts:712`). No model, $0."
---

# 239. Does `next/`'s supervision match OTP, and where it differs, is the reason written?

Read 2026-11-09, on origin/main at `db4c173a`. **This is reading, not a measurement.** Nothing
ran but one small arithmetic script, shown below. It is the check that C5 owes
([the five layers, C5](../docs/direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31)):
"A difference from OTP needs a written reason. A check that ours matches OTP is still owed."
Every claim is about `next/` (P33, [PR 507](https://github.com/usirin/tea-fabrika/pull/507);
P34, [PR 535](https://github.com/usirin/tea-fabrika/pull/535)) unless it says today's version.
Paths are under `next/packages/libfabrika/src/`.

**The answer.** Where Tier 1 builds a piece, it matches OTP or differs on purpose. Of 24 OTP
features, 7 are the same, 12 differ, 1 is added (dead letters), and 4 are missing. Every missing
one waits for Tier 4 with a written reason: Tier 1 has no process that starts another
([tier-1.md:167](../docs/plan/tier-1.md)). Of the 12 differences, 6 have a written reason and 6
do not. Five of those need only one written line each, and no code change (ticket 405, below).
Two findings need more than words:

- **Past the brake, a name never stops restarting.** OTP gives up and lets the parent decide. Ours
  waits at most about 5 s and tries again, forever. A program that always throws restarts about
  once a second, about 270,000 ledger entries a day for one broken name. Lean: close it, with a
  wait that grows like Kubernetes' (ticket 404). This is the one design call for the owner.
  *Owner decided 2026-11-09 ([0016](../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)):
  OTP's give-up, not the growing wait. Past intensity the name is `failed` until a person restarts it.*
- **`exited`'s reason is free text.** OTP's `normal`, `shutdown` and `kill` decide what a link,
  a trap or a restart type does. Free text written now cannot be sorted later. Lean: close it
  before Tier 4 (ticket 406), 65%.

Supervision is not switched on on the Worker path yet (`workers/runtime.ts:712` passes no
options, so `recovery` is null at `app/runner.ts:210-214`). Another agent is fixing that, so it is
only noted here.

```text
OTP                                   next/ today (Tier 1)
supervisor process over N children -> a supervisor machine inside each program's own object, 1 child
one_for_one | one_for_all | ...    -> one_for_one with one child; the rest wait for Tier 4
intensity 1 in 5 s, then give up   -> 5 in 5 s, then down {until}, then try again, forever
no backoff                         -> 100, 200, 400, 800 ms; reset after 5 s live
mailbox in memory, lost on exit    -> <name>/inbox on the ledger, kept, at least once
no dead letters                    -> per-letter count, then <pid>/dead at the limit (3)
links, trap_exit, EXIT             -> not built (Tier 4)
monitor, DOWN, noproc, demonitor   -> built; DOWN carries `to`; demonitor always flushes
register frees the name on exit    -> a name is never freed
any process may exit a pid         -> only the parent may
```

## What was read

OTP's own documentation, read 2026-11-09:

- [Supervisor behaviour](https://www.erlang.org/doc/system/sup_princ.html) (design principles).
  "If a child process terminates, only that process is restarted" (one_for_one). Intensity and
  period "default to `1` and `5`". Past the limit the supervisor "terminates all the child
  processes and then itself", with reason `shutdown`, and "the next higher-level supervisor takes
  some action". "A `permanent` child process is always restarted", a `transient` one "only if it
  terminates abnormally", a `temporary` one "never". "`brutal_kill` means that the child process
  is unconditionally terminated". Children "are started in the order specified by this list, and
  are terminated in the reverse order".
- [`supervisor` reference](https://www.erlang.org/doc/apps/stdlib/supervisor.html): "if more than
  `MaxR` restarts occur within `MaxT` seconds, the supervisor terminates all child processes and
  then itself". "If the child is temporary, the child specification is deleted as soon as the
  process terminates." `start_child`, `terminate_child`, `delete_child`, and auto-shutdown on
  significant children.
- [Processes reference](https://www.erlang.org/doc/system/ref_man_processes.html): "Links are
  bidirectional". A receiver not trapping exits dies on any reason "other than the atom `normal`";
  one that traps gets `{'EXIT', SenderID, Reason}`. A sent `kill` cannot be trapped.
  "Monitors are unidirectional"; `{'DOWN', Ref, process, Pid2, Reason}`; "If `Pid2` does not
  exist, the 'DOWN' message is sent immediately with `Reason` set to `noproc`." A registered name
  "is automatically unregistered if the process terminates". Between one sender and one receiver
  "the order is preserved". Messages go "to the end of the message queue".
- [`erlang` reference](https://www.erlang.org/doc/apps/erts/erlang.html): `demonitor/2` with
  `flush` "Removes (one) `{_, MonitorRef, _, _, _}` message, if there is one, from the caller
  message queue". `exit_signal/2` "Sends an exit signal with exit reason `Reason` to the process
  or port identified by `Dest`": any process that holds the pid.

Ours: the P33 and P34 code on main, and its tests' names. The supervision doc a lead agent wrote
on 2026-11-09 (outside the repo) was read as data. Each claim it made that this write-up uses was
checked against the code; its line numbers held. One of its claims is corrected below: it says
every crash restarts "like permanent"; in effect it is transient, since only a throw restarts and
a program has no normal exit in Tier 1.

## Feature by feature

Status is same, differs, added or missing. A reason is "written" only when it is in `docs/direction`, the plan or
the code. A missing feature with a Tier 4 deferral counts as written.

| OTP feature | What OTP does | What we do (`path:line`) | Status | Written reason | Lean |
|---|---|---|---|---|---|
| Registry: register | `register(Name, Pid)`; a taken name fails | First start writes `registered {name, program, owner}` (`coordination/process-manager.ts:132-144`); a taken name is `name_taken` (`coordination/process.ts:321-325`) | same | | Keep. 90% |
| Registry: name freed on exit | "automatically unregistered if the process terminates" | Never freed; a restart reuses the name (`process.ts:324-327`) | differs | A name is a stream, and the log keeps every stream ([C5 note](../docs/direction/a-local-first-sync-engine.md), "Two differences stay") | Keep. 90% |
| Registry: whereis | Name to current pid | `status(name)` reads the name's current process (`process.ts:337-354`); the door binds a resend to it (`door/door.ts:940-944`) | same | | Keep. 90% |
| Mailbox lifetime | In memory, gone with the process | `<name>/inbox` on the ledger, kept across restarts; a restart reads it again (`process-manager.ts:279-300`) | differs | C2: delivery is at least once | Keep. 95% |
| Mailbox order | Order kept per sender and receiver | One total order per inbox, by `rev` (`process-manager.ts:288`) | same, stronger | | Keep. 90% |
| Selective receive | `receive` takes the first match and leaves the rest | None: every letter reaches `update` in order | differs | None | Keep; write the reason, Elm's `update` takes every Msg ([elm-first](../docs/direction/elm-first.md)). Ticket 405. 85% |
| Poison message | Nothing built in; the restart drops the mailbox | Per-letter receipt (`coordination/recovery.ts:70-84`); at the limit, `<pid>/dead` and `refused {why: "dead"}` (`app/runner.ts:515-531`, `process-manager.ts:317-341`) | added | C2; a durable inbox would replay a poison letter forever | Keep. 95% |
| New pid per start | A restart is a new pid | A new `process_<26>` each start, `restarted {after}` (`process-manager.ts:125`, `:157-171`) | same | | Keep. 95% |
| Links | Two-way; an exit signal kills the other side | Not built (no `link` anywhere in `next/`) | missing | Tier 4, [tier-1.md:167](../docs/plan/tier-1.md) | Keep for Tier 4. 90% |
| trap_exit and `EXIT` | A trapping process gets `{'EXIT', From, Reason}` | Not built | missing | Tier 4, same line | Keep for Tier 4. 90% |
| Exit reasons | `normal`, `shutdown`, `{shutdown, T}`, `kill` decide behavior | `exited {why}`, any text up to 256 characters (`process.ts:11`, `:48`); the runner writes `step`, `saved_letter`, `interrupted`, `restart` (`app/runner.ts:350-358`) | differs | None | Close: a tagged reason before Tier 4 needs it. Ticket 406. 65% |
| Who may exit a process | Anyone with the pid (`exit_signal/2`) | Only the name's owner (`process.ts:358-371`) | differs | A job cannot kill a job it does not own (C5 note) | Keep. 85% |
| Monitor | One-way; one `DOWN` when it ends | `monitored` fact, one `DOWN` per live watch in the same transaction as `exited` (`process-manager.ts:182-214`) | same | | Keep. 90% |
| `DOWN` shape | `{'DOWN', Ref, process, Pid, Reason}` | `{_tag: "DOWN", ref, process, why, to}` (`process.ts:77-82`) | differs | `to` added so a stale `DOWN` never lands in a later life (C4 fixes list) | Keep. 90% |
| Monitor a gone process | `DOWN` at once, `noproc` | Same (`process-manager.ts:233-242`) | same | | Keep. 95% |
| Watcher ends | Its monitors go | Each outbound watch gets `demonitored {why: "watcher_exited"}` (`process-manager.ts:199-211`) | same | | Keep. 90% |
| demonitor | Keeps a queued `DOWN` unless `[flush]` | Always drops it: a canceled watch's signal is `drop` (`process.ts:423-429`) | differs | None (C4 lists the flush as a fix, not why it is always on) | Keep; write the reason. Ticket 405. 85% |
| Signals vs messages | Signals are separate and asynchronous | A `DOWN` is a letter under a signal id that only the brain writes (`process.ts:61-72`, `:183-184`, `:415-430`) | differs | None | Keep; write the reason, one durable stream a browser reads like any letter. Ticket 405. 80% |
| Who supervises | A supervisor process, linked to its children | A tea machine (`app/supervisor.ts:59`) stepped inside the program's own object (`app/runner.ts:160`, `:310-431`) | differs | One child because Tier 1 has no process that starts another (C4 "as built"); why the same object, none | Keep; write the reason, receipts and the pending action share the step's SQLite (`coordination/recovery-store.ts:18`). Ticket 405. 80% |
| Strategies | one_for_one, one_for_all, rest_for_one, simple_one_for_one | one_for_one with one child | missing (3 of 4) | Tier 4, [tier-1.md:167](../docs/plan/tier-1.md) | Keep for Tier 4. 90% |
| Restart types | permanent, transient, temporary | In effect transient: only a throw restarts (`app/supervisor.ts:84-131`); a parent's exit does not | missing | Tier 4, same line | Keep for Tier 4. 85% |
| Intensity and period | Default 1 in 5 s; more than MaxR in MaxT gives up | 5 in 5,000 ms by default (`app/supervisor.ts:7-12`), the same count rule with the edge counted (`process.ts:127-132`) | differs (numbers) | Intensity must be at least the delivery limit, or a poison letter trips the brake before it reaches dead (`coordination/recovery.ts:19`; [experiment 99](./99-monitors-supervisor.md)) | Keep. 85% |
| Past the limit | Ends its children and itself (`shutdown`); the parent decides | `down {why, crashes, until}`, then a new start at `until`, forever (`app/supervisor.ts:116-136`) | differs | No parent in Tier 1 (C4 "as built"); p80 says it tries again at `until` | **Close:** the wait grows each trip. Ticket 404. Owner call. 70% |
| Shutdown | `brutal_kill`, a timeout, or `infinity`; reverse start order | Exit is at once (`process-manager.ts:182-214`); later writes by that process are refused (`door/door.ts:1350`, `:1356`); steps are serial (`app/runner.ts:224`) | differs | None | Keep for Tier 1; write the reason. Ticket 405. 75% |

Rows under 80%, and their doubt:

- **Exit reasons, 65%.** The four runner strings may be enough, and a brain exit may always mean
  shutdown. Listing every caller of `exit` settles it. The cost of waiting: entries written with
  free text can never be sorted into normal and abnormal later.
- **Past the limit, 70%.** The owner may want OTP's give-up, a final `down` that waits for a
  person, instead of a slower retry. Either closes the gap; the owner picks.
- **Shutdown, 75%.** Once an agent run is a Cmd (Tier 4 and 5), an exit mid-run may need a
  graceful stop that tells the agent to end and records what it cost. Nothing in Tier 1 runs one.

## The one that needs numbers: past the brake

```text
always-throwing program, default policy, arithmetic from app/supervisor.ts:101-136 (not a run)
restart 1..5   waits 100, 200, 400, 800, 800 ms      (backoff, crashes never reset)
crash 6        canRestart says no -> down until the oldest of the last 5 + 5,001 ms
due            starts again; crash; down again ...
per hour       3,601 restarts, 720 downs
per day        about 86,000 restarts x (exited + started + restarted) + 17,000 downs
               = about 276,000 ledger entries for one broken name
```

The script was 8 lines of Python run in the shell, the same rule as `exited` and `due`, with an
instant crash on each start. It is not kept.

Kubernetes, the backoff C4 names, waits 10 s, doubling, up to 5 minutes
([experiment 100](./100-supervision-tree.md)): at most about 290 restarts a day. Ours caps at 800
ms, so it is Kubernetes' shape, not its scale. The saved restart list grows too:
`ProcessTable` folds every `restarted` fact (`coordination/process.ts:240-243`) and the runner
copies the whole list into each saved state (`app/runner.ts:466`, `:591`).

## What we add beyond OTP, and why

- **A durable inbox** (`<name>/inbox`). A Durable Object's memory is gone on eviction, so an
  in-memory mailbox would lose letters. The ledger already keeps every stream (C2).
- **Dead letters** (`<pid>/dead`). A durable inbox replays a poison letter after every restart;
  OTP's restart drops it with the mailbox. The count lives in the object's own SQLite
  (`coordination/recovery-store.ts:18`), and the sender hears `dead` so its outbox stops
  (`door/door.ts:90-92`).
- **Backoff.** OTP restarts at once on purpose. A restart here is a wake, writes and a load, so
  experiment 100 picked Akka's and Kubernetes' doubling wait.
- **`to` on `DOWN`.** A restart keeps the name, so a `DOWN` for an old life must not reach the
  new one.
- **Only the parent may exit.** Any process holding a pid is not a safe rule when a pid can come
  from a client.

## What a browser client and Durable Objects force

- **A browser is a client, never a process.** It has no pid, so it can watch but cannot be linked
  or supervised. A window's watch is `Recipient.client` (`coordination/process.ts:30-33`), and its
  `DOWN` lands in `client:<id>/inbox` (`:181`), read like any other stream.
- **One alarm per object.** Backoff and `down`'s `until` are saved deadlines on the object's one
  alarm (`app/runner.ts:292`), never a timer fiber.
- **Eviction at any time.** A wake that finds an unfinished step counts it as a crash, `interrupted`
  (`coordination/process.ts:105-126`, `app/runner.ts:554-612`). The supervisor saves its pending
  action before it acts, so a cut at any point resumes (`app/runner.ts:310-431`).
- **One thread per object.** One permit makes steps serial (`app/runner.ts:224`), which is what
  lets an exit be a fenced kill with nothing half-written.

## What this tells us for fabrika

- C5's check is done for Tier 1. The missing parts wait, each with its reason.
- Five differences need one written line each. One docs PR (ticket 405).
- One gap is real cost: the forever restart (ticket 404). One is lost data if it waits: the free
  reason text (ticket 406).
- Monitors exist in `coordination/` but nothing outside it calls `monitor` on main yet. P18 owes
  the tile side (tracker ticket 290).

## What it cannot tell us

- Nothing ran on workerd or Cloudflare, and supervision is not on there yet. Alarm timing and
  eviction are read from code, not seen.
- The restart rate is arithmetic from the code with an instant crash. A real crash takes time, so
  the real rate is a little lower.
- The runner is 1,462 lines. The supervision paths were read, not every line.
- No OTP code was run. The OTP side is its documentation as of 2026-11-09.

## Links

- [The five layers, C2 to C5](../docs/direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31)
- [Tier 1, coordination past the slice](../docs/plan/tier-1.md), and p79 and p80 in
  [tier-1-detail](../docs/plan/tier-1-detail.md)
- Experiments [99](./99-monitors-supervisor.md), [100](./100-supervision-tree.md)
- Tracker tickets 404, 405, 406; 290 (P18)

$0. No model run for the findings; this write-up's own agent cost is in the lead's report.
