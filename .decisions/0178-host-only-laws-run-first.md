---
id: 0178
title: A law that can only run on the real machine runs before the first review, and on the owner's Mac only after the lead's read and the owner's yes
status: accepted
date: 2026-11-13
tags: [lead, lane, build, review, plan, host, electron, launchd, fixtures, vector, kill, signal, process-group, safety]
---

# 0178: A law that can only run on the real machine runs before the first review, and on the owner's Mac only after the lead's read and the owner's yes

**What this decides:** a test that needs the real machine (launchd, the real Electron app, a real
OS process or socket) is run right after the build, before any review starts, and never at the end
of the lane.

**Before:**

```mermaid
flowchart LR
  tests["tests"] --> build["build"]
  build --> review["reviews, round after round"]
  review --> host["the host-only law runs on the real machine"]
  host --> land["the lane lands"]
```

**After:**

```mermaid
flowchart LR
  tests["tests"] --> build["build"]
  build --> host["the host-only law runs on the real machine"]
  host --> review["the first review"]
  review --> land["the lane lands"]
```

```text
# Sketch of a plan's line for one law, not a checked format.
# before
the service starts under launchd: scenario, run by the lead before the merge
# after
the service starts under launchd: scenario, host-only, run by the build before the first review
```

The host run moves from the end of the lane to just after the build.

## Context

- Some laws cannot run in a step's box. They need a real Mac: launchd, the real Electron app, a
  real OS process or a real socket. Call such a law host-only.
- **The measured case, 2026-11-13.** P19 slice 1
  ([pull request 1079](https://github.com/kamp-us/tea-fabrika/pull/1079)) went through eleven
  reviews before its one host-only law was run. The first host run failed at once, on two faults:
  - the test's helper bundles were empty;
  - the product read macOS 14's "not loaded" output as an error, so the service could never start
    on a real Mac.
- The fixtures in its laws had been written without a real Mac's output.
- So every review before that run argued over rare edges of something that had never started.
- **The second measured case, the same day.** A later host run of that law ended every process
  the person at the Mac owned: every app, every terminal and a live video stream.
  - The test's cleanup kept a list of process groups to signal, taken from the process table.
  - That run's list was `[65831, 66680, 67964, 70410, 71425, 1, 72448]`.
  - `kill -TERM -1` signals every process the caller's user owns (POSIX `kill`, a pid of -1).
  - The command that started the run was only "run this test file". The 1 was read from the
    process table while the test ran, so no check of the command could see it.
  - The lead had allowed the run without reading the cleanup.
- **How it fits older decisions.**
  - [0052](0052-tests-never-depend-on-the-machine.md) stands. A host-only law needs a real
    machine, never one person's own home folder or data.
  - [0045](0045-test-steps-run-in-containers.md) stands for a step's box. A host run is outside it.

## Decision

**A host-only law runs on the real machine before the first review, and a build is not done while
it has not passed there (owner, 2026-11-13).**

- The plan marks each host-only law as one the build step runs, or the lead runs right after the
  build, before any review starts.
- A build is not done while its host-only law has not passed on a real machine.
- A fixture that stands in for a real tool's output is taken from a real run and labeled as a
  vector.
- **On the owner's Mac, a host-only law runs only after two things (owner, 2026-11-13, after the
  second case):**
  - the lead has read every line the test can reach that signals a process or calls launchd;
  - the owner has said yes.

**Binding constraints.** These rules stay:

- A test window never takes focus.
- One Electron test app at a time.
- The test uses its own temp home and its own test label.
- It leaves nothing behind.

## Consequences

- The first review reads something that has started on a real machine.
- **The cost:** a build takes longer to be done, and it waits on the lead's read and one answer
  from the owner. A host run uses the person's machine while they may be working on it.
- A step agent never starts a host-only law on the owner's Mac on its own. It reports each line
  that signals a process or calls launchd, with what stops a wrong target, and the lead takes it
  from there.
- The plan, build and lead skills each say their part.
- Not decided: whether one yes covers later runs of the same test.
- Not decided: whether a machine that is not the owner's Mac (another user account on it, a
  virtual machine) needs the owner's yes.
- Not decided: how this runs in `next/`'s own pipeline. There a step runs in a container
  ([0045](0045-test-steps-run-in-containers.md)), and a host run needs the person's machine. It is
  open.

## Records

- `.glossary/TERMS.md`: a row for **host-only law**, in Pipeline.
