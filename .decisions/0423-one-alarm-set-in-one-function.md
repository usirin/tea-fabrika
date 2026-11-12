---
id: 0423
title: An object has one alarm, set in one function at the earliest timer it holds, so no timer overwrites another
status: accepted
date: 2026-11-07
tags: [next, durable-objects, alarms, timers]
---

# 0423: An object has one alarm, set in one function at the earliest timer it holds, so no timer overwrites another

```ts
// From next/packages/libfabrika/src/runtime/Runner.ts, shortened.
/** One object alarm: program work is eligible only while live. */
const setAlarm = Effect.fnUntraced(function* (retryAt?: number) {
  // ... the earliest of the program's wake, its supervision wait and its mail retry
  const next = wake === null ? until : until === null ? wake : Math.min(wake, until);
  if (alarmAt === next) {
    return;
  }
  yield* alarm.set(next);
});
```

**What this decides:** how an object with many timers (leases, a job's next run) uses its one
alarm.

## Context

From [scheduled jobs run on the host's alarms](../docs/direction/scheduled-jobs-on-the-host.md),
decided by the owner 2026-11-07. It settled a draft that said one alarm per host.
[0105](0105-a-durable-object-never-stays-awake-on-its-own.md) holds that later work is an alarm.

## Decision

**One alarm per object, and one function sets it.**

- A Durable Object has one alarm. Every timer in the object, the ledger's leases among them, goes
  through one function, which sets the alarm at the earliest timer.
- So no timer overwrites another.
- It is tested by killing the object mid-step, then running its alarm.

## Consequences

- `next/`'s runner sets its alarm through one function (`setAlarm` in
  `next/packages/libfabrika/src/runtime/Runner.ts`).
