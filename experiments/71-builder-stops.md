# 71. The builder stops with its run, one builder per working copy, and a restarted builder carries on

```sh
pnpm vitest run src/stages/build/guard.test.ts src/stages/build/builder.test.ts src/stages/build/program.test.ts
# The live check, on a sandbox ticket. A build job, killed mid command, then attached again:
TSH_WORK=<folder> TSH_OWN=<your login> bin/tsh -c \
  'build --model opus --effort medium --budget 3 ticket=https://github.com/kamp-us/tea-fabrika-sandbox/issues/7 & attach %1'
kill -9 <both tsh processes>
TSH_WORK=<folder> TSH_OWN=<your login> bin/tsh -c \
  'jobs; attach %1 & tell %1 ticket https://github.com/kamp-us/tea-fabrika-sandbox/issues/7; close %1 ticket; attach %1'
```

## What broke

Experiment 69, finding 2. The builder is the Agent SDK's `claude` process, a
child of tsh. A `kill -9` of tsh does not reach it. It was re-parented to
init and kept working in the copy, on the owner's account. The reattached run
then started a second builder in the same copy. Two builders in one copy can
write over each other.

Two more things were true, and found here:

- `claude` runs each Bash command in a session of its own. So even when the
  SDK does stop `claude`, a long command it started (`pnpm test`, `npx tsc`)
  is not in `claude`'s process group and can outlive it.
- The SDK's own stop (end stdin, wait about 2s, SIGTERM, SIGKILL 5s later)
  runs in tsh. When tsh is killed with `kill -9`, none of it runs.

## The mechanism

One small process, the guard (`src/stages/build/guard.ts`), sits between
tsh and `claude`. The SDK's `spawnClaudeCodeProcess` starts the guard
instead of `claude` (`src/stages/build/guarded.ts`). It does two jobs.

**It holds the copy.** The guard takes an exclusive `flock` on
`<copy>.lock`, a file beside the copy, then `exec`s `claude` in its place
(a few lines of perl). The lock lives on the open file, not in it. `claude`
holds it for as long as it runs. When the last holder dies, however it dies,
the kernel drops the lock. Nothing is written in the file: no PID, no
time, nothing a crash can leave stale. A second builder on the same copy
waits up to 30s for the lock (time for an old one to finish stopping), then
is refused with exit 75 and `held: the working copy is held by another live
builder`. The build reads that line as the run's error.

**It stops the builder with the run.** tsh keeps one end of a socket pair
on the guard's fd 3 and never writes to it. When tsh ends, by any road
(`kill -9` too), the kernel closes it and the guard reads the end. The guard
then stops the whole tree under `claude`: every process and every process
group, SIGTERM, up to 2s, then SIGKILL. It reads `ps` every 2s while the
builder runs and remembers what it saw under `claude` (pid and start time),
so a Bash command already cut loose from `claude` is still stopped, and a
reused pid is told apart by its start time. The guard runs in a session of
its own, so a Ctrl-C to tsh's group does not kill it before it has stopped
the builder. The same stop runs on a normal end, on `stop`, on Ctrl-C, and on
an Effect interrupt: each of those ends tsh's side of the guard.

**It carries the conversation on.** The build machine keeps a session id
for each round (`session` in its state, named by `buildToTheEnd` before
`keep.run` reads the kept state, used by `first` only on a fresh start).
The builder now runs with `persistSession: true` and `sessionId: <that id>`.
A builder started again after a kill finds the conversation on disk
(`getSessionInfo`), runs with `resume: <id>`, and is told to look at the copy
first (`git status`, `git diff`) and carry on, not start over.

## Tried and dropped

| What | Why not |
|---|---|
| A PID in a lock file | demlik #689: a reused PID or an empty file and the next start waits for good. Ruled out by the brief. |
| The storage's fenced handle | It fences writes to storage, not a live process. It cannot tell a dead holder from a live one without a time or a PID, and there is a window between the check and the write (68a). |
| sqlite's lock | After a `kill -9` of the holder, the journal was left, and the next open said `database is locked`. It wedged. |
| A TCP port or a Unix socket as the lock | A port can collide with something else; a socket file is left behind after a crash and has to be cleaned, which races. |
| The SDK's `signal` and process-group kill alone | Both run in tsh. A `kill -9` of tsh runs neither. |
| `sessionStore` (alpha) on our storage | It could sit on an Effect KeyValueStore (append a batch per key, keep a count). But it only mirrors: it needs `persistSession` on the local disk anyway. The copy is on the local disk too, so moving a run to a new machine needs both moved. Not built. |
| `resumeSessionAt`, `forkSession` | Not needed. A plain `resume` after a `kill -9` mid tool call works: the CLI adds one synthetic turn ("No response requested.") for the cut-off one and goes on. |

## Proofs

Tests, with a stand-in for `claude` (`fixtures/builder-stop/`) that starts a
child in a session of its own, which starts a grandchild:

| Test (`src/stages/build/guard.test.ts`) | Shows |
|---|---|
| `kill -9` of the parent | the guard, the agent, its child and grandchild all stop, and the copy is free |
| SIGTERM to the guard | all three stop |
| the agent ends by itself | nothing is left behind, guard exits 0 |
| a second builder on a held copy | refused with 75 and the `held:` line; the first runs on |
| a new builder right after a `kill -9` | it starts only once none of the old pids is alive; never two |
| a lock file left by a crash, with junk in it | the next start takes it at once |
| the guard killed alone | the agent still holds the lock; a second start is refused |
| `toStop` | a pid seen before and reused by a new process is not signalled |

`builder.test.ts`: a first run starts the conversation under the round's
session id with `persistSession: true` and the whole brief; a run started
again uses `resume` with the carry-on prompt. `program.test.ts`: a build cut
off mid run and started again hands the builder the same session id.

Live, on [sandbox ticket 7](https://github.com/kamp-us/tea-fabrika-sandbox/issues/7)
(a copy of demlik #643). A watch read `ps` every second and counted the
`claude` processes whose working folder is the copy. tsh is two node
processes; both were killed with `kill -9` at once, about 80s into the
build.

| Run | What happened |
|---|---|
| 1 | Killed between commands. `claude` and the guard gone 1s later; lock free; the copy held half-done edits. |
| 2 | Killed mid `npx tsc`. Nine processes under tsh: the guard, `claude`, and `zsh → npx → npm exec → node tsc` plus `head`, in a group of their own. All gone 1s later. |
| 3 | Killed mid command (`zsh → sed`). All gone 1s later. Attached again: a builder started 11s after the kill with `--resume=<the same id>`. It ended `done` and opened [pull 9](https://github.com/kamp-us/tea-fabrika-sandbox/pull/9), `runs 2`, one commit. |

The watch never counted two builders on a copy: 1,014 ticks across the
three runs, at most one each. No builder was left running after any kill.

The resumed builder's first words: "I'm checking where the work stands. So
far I've only read code and reproduced the bad error in a scratch folder."
It ran `git status` and went on to the fix. It did not read again the files
its first life had read.

| | Before the kill | After the resume |
|---|---|---|
| cost | $0.42 | $2.23 |
| turns, tool calls | 9, 10 | 45, 47 |
| minutes | 1.3 | 11.7 |

What the resume saved: the three first lives each spent $0.42 to $0.52 and
about 80s reading the same code and building the same repro. The resumed one
spent $0.04 on its first turn (the old conversation read back from cache)
and none of that again. About $0.40 and 1.3 minutes on this ticket, which is
all of the work done before the kill. A later kill saves more. There was no
fresh-start control run; the three first lives stand in for one.

## Findings

1. **A `kill -9` of tsh now stops the builder and everything it started,
   within about a second.** Three live kills, two mid command.
2. **`claude` runs each Bash command in a session of its own.** Stopping
   `claude`'s group is not enough; the tree has to be walked.
3. **A builder started again carries on.** With `persistSession` on and the
   round's id kept, `resume` after a `kill -9` mid tool call works with no
   extra option.
4. **The agent refuses a session id it already has** ("Session ID … is
   already in use"), and `resume` of an id it does not have ends at once
   ("No conversation found"). So the id is new for each start of a round,
   and `resume` is used only when `getSessionInfo` finds it on disk.
5. **A build job started with `close %1 ticket` cannot be told its ticket
   after a reattach.** Inputs the run's record marks closed start closed. A
   bare `attach %1` ends the job at once, tsh drops it, and the build's kept
   state is left in storage with no job to reach it. It happened twice here.
   A job started without `close` can be told the ticket again, and then it
   goes on (run 3).
6. **sqlite's lock wedges after a `kill -9`.** Dropped.

## Recs

1. **Keep the guard as the one way the builder starts** (85%). It is the
   only piece that survives a `kill -9` of tsh, and the lock cannot go stale.
   Tradeoff: one more process and a perl dependency. Owner: tea-fabrika's
   build stage.
2. **Start the reviewer under the guard's stop too, without the lock**
   (60%). It is a `claude` started the same way, so a `kill -9` leaves it
   running and spending. It has no shell and reads only, so there is no tree
   to walk and two at once does no harm; the lifeline alone would do. Not
   tried. Owner: tea-fabrika's review stage.
3. **Let a reattached job be told again the values it was told on its first
   line** (65%), or keep the job and say why it ended, so finding 5 cannot
   strand a kept build. Owner: tsh.
4. **Do not build `sessionStore` on our storage yet** (75%). It saves
   nothing until a run can move to a new machine with its copy. Owner: tea-program.

## Holes

| Hole | Owner |
|---|---|
| The guard killed alone with SIGKILL leaves `claude` running. The lock still refuses a second builder, so never two; but this one does not stop with the run. | tsh (nothing sends that signal today) |
| perl is needed for `flock`. macOS ships it; a later macOS may not. Node has no `flock`. | tea-fabrika's build stage |
| `flock` on a network folder may not hold across machines. The copy is expected on a local disk. | user config |
| A Bash command that leaves `claude`'s tree and is not seen in the 2s between two `ps` reads is not stopped. | tea-fabrika's build stage |
| Conversations now stay in `~/.claude/projects`, removed by Claude Code's `cleanupPeriodDays`. A round restarted after that starts fresh, with the carry-on prompt missing; it still works, from the copy. | user config |
| The SDK's `claude` binary changes the way it starts commands: finding 2 may change with it. | the Agent SDK |

## Where Node is used

- `src/stages/build/guarded.ts`: `node:child_process` `spawn`. The SDK's
  `spawnClaudeCodeProcess` wants a Node ChildProcess, synchronously.
- `src/stages/build/guard.ts`: `node:net` `Socket` on fd 3 (Effect has no
  way to open an inherited fd), and `process.kill` for the signals.
  Starting `perl`, reading `ps`, the watch, the stop and the exit code are
  Effect (`effect/process` ChildProcess, `Schedule`, a scope finalizer,
  `NodeRuntime.runMain`).
- The lock is perl: `flock` then `exec`, so `claude` holds it itself.

`@demlik/tea` is unchanged.
