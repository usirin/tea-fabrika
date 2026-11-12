# One id per thing

**Decided 2026-11-07.** `next/`. Every thing has one id. A thing people count also gets a number,
and only the program that owns the thing prints that number.

Its decided rules are in: [0211](../../.decisions/0211-one-typeid-per-thing.md).

```ts
// A sketch, next/. Id.make gives a branded Schema for one type of thing.
const TicketId = Id.make("ticket"); // decodes "ticket_01h455vb4pex5vsknk084sn02q", refuses the rest

class Ticket extends Schema.Class<Ticket>("Ticket")({
	id: TicketId, // what data points at, everywhere
	n: Schema.Int, // 193: what people say and type, printed by the tracker only
	title: Schema.String,
}) {}

// A picker row: the id stays hidden, the label is the tracker's own print of n.
{id: t.id, label: `#${t.n}`, title: t.title}
```

## What was decided

- **One id per thing:** `<type>_<suffix>`, where the suffix is a UUIDv7 written as 26 base32
  characters. That is the [TypeID format](https://github.com/jetify-com/typeid/tree/main/spec):
  a lowercase type prefix, an underscore, and the UUID in Crockford base32. A UUIDv7 starts with its
  time, so ids sort by when they were made.
- **Made where it is needed,** with `Id.make("ticket")`, which returns a branded Schema. A
  `TicketId` cannot be passed where a `ProcessId` is wanted, and a bad string fails at decode.
- **Data always points at the id.** A ledger entry, a link, a location or a pipe names the id,
  never a number or a title.
- **A thing people count also gets `n: Schema.Int`.** Only the program that owns the thing prints
  it (`#193` for a ticket, `build:7` for a step run) and parses it back.
- **The desk, pickers and the shell never parse an `n`.** They carry the id and show the label the
  owning program gave them.
- **An input id is a TypeID too:** `input_<UUIDv7 in 26 base32 chars>`, like every other thing.
  Decided by the owner, 2026-11-08. The door's process and its count stay, as their own fields on
  the entry, not packed into the id. This closes [tier-1.md question 20](../plan/tier-1.md#open-questions).
  *It said: input ids are open. That was wrong: the 2026-11-07 ids sketch already gave every thing
  this shape, and `in-<process>-<n>` was the only id left outside it.*

## Where main stands

Main's `next/` has the `Id` module since ticket 518's first pull request:
`next/packages/libfabrika/src/id.ts`, exported as `Id` from `@kampus/libfabrika`. It has
`Id.make`, `Id.makeEffect`, `Id.Generator` (it fails with a typed `IdError`) and `Id.Order`, and
process and input ids are made with it. It took in the smaller `data/id.ts` that P17 had added, so
there is one module. An id's check is a plain pattern, so Effect's `Arbitrary` can generate ids in
tests. `ProcessId` stays unbranded for now. `Entry`, `Letter` and member ids are still loose strings.
The second pull request moves them, with input ids and `n`, once P12 and P34 land.

Main's door (P10, [PR 502](https://github.com/usirin/tea-fabrika/pull/502)) still makes
`in-<process>-<n>`, and the entry's `parent` pattern matches that shape. A build pull request
moves both to `input_<26 chars>`.

## What it changes

- [Pickers](./picker-guidelines.md): a row's `id` was the ticket's number as text (`#193`). It
  becomes `id: t.id, label: \`#${t.n}\``.
- The glossary gets `id` and `n` rows ([TERMS](../../.glossary/TERMS.md)).

## What it cannot tell us

- How `Id.make` reads in a stack trace or a log line next to a 26-character suffix. No code
  exists yet.
- Which things get an `n`. Tickets and step runs do; the rest is decided per program.
- What the two door fields on the entry are named. The build pull request sets them.
