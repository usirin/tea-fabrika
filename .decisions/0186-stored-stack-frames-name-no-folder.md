---
id: 0186
title: In next/, stored error content names no folder of a machine, and the supervision law reads each stack frame by its name, file name, line and column
status: accepted
date: 2026-11-13
tags: [telemetry, sink, spans, stack, privacy, laws, loosening, next]
---

# 0186: In next/, stored error content names no folder of a machine, and the supervision law reads each stack frame by its name, file name, line and column

**What this decides:** what a stored error's stack frames hold in `next/`, and what the supervision
law may ask of them.

```text
what Cause.pretty gives                      what the sink stores
Error: the message                           Error: the message          (word for word)
    at step (<root>/app/counter.ts:12:3)         at step (counter.ts:12:3)
    at f (file:///bundle/brain.mjs:10:2)         at f (brain.mjs:10:2)
    at Array.map (<anonymous>)                   at Array.map (<anonymous>)
```

## Context

[Pull request 1012](https://github.com/kamp-us/tea-fabrika/pull/1012), hot reload's first slice,
carries a rule its plan added. The span sink (`next/packages/libfabrika/src/telemetry/Sink.ts`) cuts
the folder out of every stack frame before an error's content is stored. A folder on a person's
machine can hold an account name, and stored records are shared. Two new laws in
`next/packages/libfabrika/src/telemetry/Sink.test.ts` hold the rule: no stored frame line names a
folder, and nothing else is lost.

A law already on main, in `next/packages/libfabrika/src/node/dev/supervision-spans.test.ts`, asks
that a throw's original message and stack are in kept content word for word. A stack with its
folders cut is not word for word, so that law is red on pull request 1012. The other way out,
storing a program's own throw raw and apart from the sink, puts machine paths back into stored
records.

A law that accepts something else is a loosening, which waits on the owner
([0014](0014-the-lead-merges-when-every-step-passed.md)). The owner said yes on 2026-11-13.

## Decision

**Stored error content keeps each stack frame's name, file name, line and column, and never its
folder. A law about that content asks for those parts, not for the stack word for word.**

- **The supervision law changes.** It asks that the throw's message is in kept content word for
  word, and that each stack frame is there by its name, file name, line and column.
- The rest of that law stays: the content can be deleted, and only classes stay in receipts, dead
  events and measurements.
- The law does not work out what it expects by calling the sink's own cutting code. A law that calls
  the code it judges proves nothing.
- A throw is never stored raw beside the sink to keep an older law green.
- This is the rule that
  [every law is a property](../docs/direction/five-steps-for-every-check.md#every-law-is-a-property),
  applied here. The property is that a throw's content reaches the store and can be deleted there.
  The exact text of a stack is not the property.

## Consequences

- Pull request 1012 can land once the law is changed and its checks are green. Its description
  carries `loosening.sh`'s full output and a link to this file.
- **What it costs:** the folder of each frame is gone for good from stored errors. Two files with
  one name, such as two `index.ts`, differ only by the function or span name beside them.
- **Not decided here:**
  - Whether a file name and a line are enough to find the spot a year later. The first real failure
    read back from a stored record settles it.
  - A path inside a thrown value's own message. A message is kept word for word, and a person can
    delete a span's content
    ([an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md)).
  - Any other law that asks for a text word for word. Each one is its own read.
