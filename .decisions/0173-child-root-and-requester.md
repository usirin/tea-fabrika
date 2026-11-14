---
id: 0173
title: In next/, a program's write is child or root, OpenTelemetry's words, never caused or own, and the key that names who asked for a brain-written line is requester, never asked
status: accepted
date: 2026-11-13
tags: [names, write, child, root, requester, parent, opentelemetry, glossary, next]
---

# 0173: In next/, a program's write is child or root, OpenTelemetry's words, never caused or own, and the key that names who asked for a brain-written line is requester, never asked

**What this decides:** three renames in `next/`, each to the industry's word: the two cases of a
program's `Write`, and one body key.

```ts
// today, next/packages/libfabrika/src/runtime/Program.ts
export const Write = Schema.TaggedUnion({
  caused: { parent: ParentText, event: Event },
  own: { event: Event },
});

// after the rename
export const Write = Schema.TaggedUnion({
  child: { parent: ParentText, event: Event },
  root: { event: Event },
});
```

```ts
// today, the body of a line the brain's process manager writes
{ process: "process_01...", reason: "crashed", asked: "SHA256:window-a" }

// after the rename
{ process: "process_01...", reason: "crashed", requester: "SHA256:window-a" }
```

Only the names move. Each case keeps its fields, and the body key keeps its value.

## Context

The owner decided this for `next/` on 2026-11-13. It applies
[use the industry's names](../docs/direction/use-the-industrys-names.md) to three words of our own.

- `caused` and `own` came with P11's `Write` and were kept by
  [0140](0140-gateway-refuses-client-id-and-by.md). This decision changes 0140's case name `own`
  to `root`. The rest of 0140 holds: a write with no cause is still the process owner's.
- A write's `parent` and `traceId` are already OpenTelemetry's names
  ([0262](0262-a-write-carries-parent-and-traceid.md)). OpenTelemetry names the two cases too:
  "A span is said to be a root span if it does not have a parent", and a span with a parent is a
  child span
  ([OpenTelemetry's tracing API, Span](https://opentelemetry.io/docs/specs/otel/trace/api/#span)).
- `asked` is the key of the caller, kept in the body of every line the brain's `ProcessManager`
  writes itself (P33). A start already says `requester` for the one who asked: the `Child` type in
  `next/packages/libfabrika/src/processes/Children.ts`. One idea had two words.
- The industry says requester for the party that asked, apart from the party that owns: Amazon S3's
  [Requester Pays](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RequesterPaysBuckets.html)
  sets the requester beside the bucket owner, as our line sets `requester` beside `by`.

## Decision

**In `next/`, `Write`'s cases are `child` and `root`, and the caller's key on a brain-written line
is `requester`.**

- `caused` becomes `child`: a write with a `parent`, as a child span has one.
- `own` becomes `root`: a write with no `parent`, as a root span has none. `own` is gone as a case
  name.
- `asked` becomes `requester`, the word `Child` already uses, so one word covers both.
- **`child` now has two uses in `next/`, and this was known before the yes.** `Child` is a process
  a start made for a requester, OTP's word. `Write`'s `child` is a write that names its parent.
  They sit in different types. Each has its own glossary row, and each row says what it is not.
- `root` here is a write's case. It is not the root supervisor, which keeps its own glossary row.

## Consequences

- No code changes with this file. The rename is a ticket. Until it lands, code on main still says
  `caused`, `own` and `asked`, and the glossary rows say so.
- The rename touches the wire: a program's `write` Cmd carries the case as `_tag`, and lines
  already written carry `asked` in their bodies. The ticket's plan says what happens to both.
- 0140's status now names this file. Its body is not edited.
- Notes that still say `caused` or `own` are changed in their own pull requests.

Not decided here:

- Nothing else in the `Write` shape changes: `parent`, `event` and their types stay.
- The ledger entry's own field names are not renamed.
- Other uses of the word `own` in code, such as `CheckedWriter`'s `own` call, are not named by this
  decision.

## Records

[`.glossary/TERMS.md`](../.glossary/TERMS.md): `write (program)` changed; `child (write)` and
`root (write)` added under Runtime; `requester` replaces `asked (body key)` under Ledger; `child`
and `root supervisor` each gained a "not" line; one line for `child` added to the context map.
