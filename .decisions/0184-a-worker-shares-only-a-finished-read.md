---
id: 0184
title: In next/, a Worker shares only a finished read across requests, never one still under way, and law L16's HTTP row counts one call for each early request
status: accepted
date: 2026-11-13
tags: [worker, cloudflare, requests, settings, laws, loosening, next]
---

# 0184: In next/, a Worker shares only a finished read across requests, never one still under way, and law L16's HTTP row counts one call for each early request

**What this decides:** what requests to the brain's Worker may share, and what law L16 counts for
them.

```ts
// next/packages/libfabrika/src/cloudflare/fetch.ts, the shape of it.
const isolates = new WeakMap<Env, Context.Context<RecordedStart>>(); // finished reads only

export const httpContext = (env: Env) =>
  Effect.suspend(() => {
    const known = isolates.get(env);
    return known !== undefined
      ? Effect.succeed(known) // a read has finished: no call
      : read(env).pipe(Effect.tap((context) => Effect.sync(() => isolates.set(env, context))));
  }); // no read has finished: this request reads for itself
```

## Context

A fresh Worker must ask the Project for the recorded start before it can answer a request. The
Worker used to keep one runtime for each `env` and hand every request the same effect, so requests
that arrived together shared one read. Law L16
(`next/packages/libfabrika/src/cloudflare/SettingsTest.ts`, which lands with
[pull request 1146](https://github.com/kamp-us/tea-fabrika/pull/1146)) pinned that: 2 to 6 entries
at once on a cold owner make exactly one `settingsStart` call, on every path in.

The platform does not allow that sharing in a plain Worker. Each request has its own I/O context,
and the platform cancels as hung a request whose own work has ended while it waits on something
another request started
([Cloudflare's errors page](https://developers.cloudflare.com/workers/observability/errors/),
"Cannot perform I/O on behalf of a different request" and "The script will never generate a
response"). The documented way is to keep only finished data in global scope. L16's HTTP row ran on
a Node double with no I/O context for each request, so it pinned a sharing the double allows and the
real Worker does not.

The fix, commit `f12ca21e2` in pull request 1146, makes each request that arrives before any read
has finished read for itself. That is safe: the Project records a start under a one-permit lock (its
`turn` in `next/packages/libfabrika/src/cloudflare/runtime.ts`), and recording the same start again
returns the first receipt (`next/packages/libfabrika/src/cloudflare/SettingsRecorded.ts`, over
`next/packages/libfabrika/src/cloudflare/SettingsStartsLedger.ts`). But it makes L16's HTTP row
red: the law expects 1 call and sees one for each request.

A law that accepts more is a loosening, which waits on the owner
([0014](0014-the-lead-merges-when-every-step-passed.md)). The owner said yes on 2026-11-13.

## Decision

**In a plain Worker, requests share only what has finished. Nothing still under way crosses from one
request to another.**

- This holds for every value a Worker keeps for an `env` or in global scope: a recorded start
  today, any cache tomorrow.
- **L16's HTTP row changes, and stays exact.** For a cold owner hit by `n` requests at once:
  `n` `settingsStart` calls, one for each. Once one read has finished: 0 calls for every later
  request. No range, no "at most".
- **The row's reads follow its calls, also exact (owner, 2026-11-13).** Each call reads the start
  once, so a cold concurrent move makes `n` reads, or `n + 1` when the start is not yet stored: the
  one call that finds nothing appends it and reads it back. Appends stay at one.
- **The other four paths keep "exactly one call".** Project, Connection, Process and RecordPart are
  Durable Objects, where one object shares its context across requests.
- A new law holds the rule itself: a request never waits on another request's read
  (`next/packages/libfabrika/src/cloudflare/fetch.test.ts`, a property, and a scenario on the real
  local runtime in `next/apps/fabrika/src/settings-start.test.ts`, both added to by pull request
  1146).

## Consequences

- A request to a fresh Worker cannot be canceled for waiting on its neighbor.
- The cost: a fresh Worker hit by `n` requests makes `n` calls where it made one. That lasts until
  the first read ends, and each extra call returns the first receipt.
- What this cannot tell us: nobody ran the old code on the real runtime a second time to watch it
  hang. The reason rests on Cloudflare's docs and on the failure that led to the fix. Cloudflare's
  docs do not say in one sentence that waiting on another request's read is canceled; it is read
  from the two parts above.
- Not decided here: whether a Worker should warm the read before its first request, so that no
  request pays for it.
