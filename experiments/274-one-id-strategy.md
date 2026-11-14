---
date: "2026-11-07"
scripts: "none; a throwaway script made example ids and the math, not kept"
summary: "Reading, not a measurement; `next/`. The input id's 32-bit random run part per door start repeats: `1 - exp(-N²/2^33)`, 1.2% at 10,000 starts, 50% at 77,163, 98% at 182,500. At a guessed 500 to 3,000 starts a day, that is 50% in 26 to 154 days, and a repeat can sign a write as the wrong person. The 16-bit note id `n-7f3a` repeats at about 301 notes. The letter id repeats if a client's counter resets. A UUIDv7 written as a TypeID collides at about `k²/2^75`: 3 in 10^17 at 1,000 ids in one millisecond. Lean 80%. For outside events, the lean is to dedupe in the ledger on the source's key, 70%. Decided as [one id per thing](../.decisions/0211-one-typeid-per-thing.md), with the input id added on 11-08. The study's \"a number in place of an id\" did not survive. No model, $0."
---

# 274. Do `next/`'s settled id shapes repeat, and what one id strategy fixes them?

Read on 2026-11-07; moved here on 2026-11-11. **This is reading, not a measurement,** plus one
throwaway script that made the example ids and did the collision math (not kept). Nothing was
built or run in the repo, no model was called beyond the one agent that read, and it cost $0. It is
about `next/` only. The decision it led to is [0211, one id per thing](../.decisions/0211-one-typeid-per-thing.md),
decided the same day and extended on 2026-11-08; that note holds the rule, and this write-up holds
the math and the sources behind it. Where the decision differs from the study's lean, the section
"What was decided" says so.

**The answer: the input id as settled then, `in-<run part>-<n>` with a 32-bit random run part per
start of a door object, repeats: 50% at 77,163 starts, so within about 26 to 154 days at a guessed
500 to 3,000 starts a day. A made id (a UUIDv7 written as a TypeID) fixes it with no state.** The
note id `n-7f3a` repeats at about 301 notes, and the letter id `<peer>-<written>` repeats if a
client name is ever reused with its counter back at 0. 80% sure on the math's use, 70% on the
outside-event lean.

```ts
// The study's sketch: three kinds of id, one rule: an id always says what it is for.
{ ticket: 41 }                               // 1. a number a person types; the owner's SQLite makes it
"note_01m6v5270hfn9b0fmn085scv4t"            // 2. a made id: the writer makes it, no round trip
"SHA256:Xq3…"  "4bf92f3577b34da6a3ce929d0e0e4736" // 3. a derived id: a hash or an outside standard
```

## The input id's run part repeats

The settled law (Tier 1 detail, p67, as of 2026-11-07) said the run part is "fresh at each start of
the door's object" and "no id is made twice across any number of starts", without saying how fresh
is made. If random, it has 32 bits (8 hex digits).

- **There are many doors.** The door's code runs in the gateway, one gateway object per client.
- **A wake is a start.** Cloudflare: hibernation comes "after 10 seconds of inactivity", then "the
  `constructor()` will run again" and "the in-memory state is discarded"
  ([lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)).
  The counter `n` lives in memory, so after a wake the door must take a new run part.
  [Experiment 174](./174-effect-on-cloudflare.md) saw Miniflare sleep an object within 16 s, and a
  ping not wake it (20 of 20 pings, 0 wakes).
- **The birthday bound.** With N starts, each drawing 32 random bits, the chance two share a run
  part is about `1 - exp(-N² / 2^33)`. It reaches 50% at `sqrt(2 ln 2 · 2^32)` = 77,163 starts.

| Starts so far | Chance two share a run part |
|---|---|
| 1,000 | 0.01% |
| 10,000 | 1.2% |
| 77,163 | 50% |
| 182,500 (500 a day for a year) | 98% |

- **How many starts: a guess.** A gateway wakes on the first frame after 10 s of quiet; a person
  working in bursts may wake it 20 to 60 times an active hour; with 3 to 6 clients (the Mac window,
  the menu bar, a phone tab, agent bridges) that is about 500 to 3,000 starts a day. Even at 50 a
  day, 50% comes within about four years, so the fix does not rest on the guess, only its urgency.
- **What a repeat does.** Both starts count `n` from 1, so `in-3f9a0c21-1`, `-2` and on repeat
  exactly, and two inputs from two people carry the same cause text. The signer looks a cause up in
  its own table to decide who signs a write ([inputs carry their sender](../docs/direction/inputs-carry-their-sender.md)),
  so a repeat can sign a write as the wrong person. The planted test "a run part reused after a
  restart" cannot catch it: a test would need about 77,000 starts.

**Two fixes.**

- **(a) Count starts, with a number per gateway handed out once.** The door's SQLite counts its
  starts, but gateway 1's start 3 and gateway 2's start 3 make the same ids, so it needs a client
  number from one place, as Zed and Kafka do. Zed: "centrally assign each replica a unique id when
  it's created ... By inheriting uniqueness from the replica id, replicas can generate ids
  concurrently without risk of collision" ([Zed's CRDTs](https://zed.dev/blog/crdts)). Kafka:
  "Every new producer will be assigned a unique PID during initialization", with sequence numbers
  per PID ([KIP-98](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging)).
  So `input_<client>_<start>_<n>`, for example `input_4_312_7`: unique by construction, one write
  per wake, two tables, about 60 to 90 lines and their laws. One hole: a gateway whose storage is
  wiped while its name lives must ask for a new client number. And it is a third format.
- **(b) A made id: a UUIDv7 written as a TypeID,** `input_01m6v5270hfjxbdfx5331ncfqx`. 48 bits of
  milliseconds and 74 random bits ([RFC 9562, 5.7](https://www.rfc-editor.org/rfc/rfc9562.html)).
  Two ids collide only in the same millisecond, about `k² / 2^75` for `k` ids in it: 3 in 10^17
  even at 1,000 inputs in one millisecond. RFC 9562 6.2 gives a counter method, so one maker never
  repeats inside a millisecond. No state, no table, no hop; the same code runs in a gateway, in
  Node tests and in a browser.

**Lean: (b), 80%.** One format for every made id, nothing stored or handed out, and "only the door
makes it" holds. The doubt: (a) is unique by construction, (b) only by probability; if p67 must be
a law a test can prove, (a) is the branch. Side finding: the signer's table of causes must outlive
a wake too, since a cause can wait in a program's queue while the gateway sleeps.

## The other settled shapes

- **The note id is short.** `n-7f3a` is 16 bits; two windows picking at random share one at about
  301 notes (the same bound). The plan said two unlinked windows "cannot pick the same one", which
  is not true at that size. The refusal of a new note over a used id kept data safe but showed a
  confusing "changed elsewhere". And an agent saving through `notes_save` would pick the id itself;
  a model is a poor source of random bits. A made id fixes both if code makes it, never the agent.
- **The letter id rests on a counter that must never reset.** [PR 223](https://github.com/usirin/tea-fabrika/pull/223)
  made `${peer}-${written + 1}`, and the ledger keeps one line per `(stream, id)`. If a client name
  is reused with `written` at 0 (a reload, if the tab name survives it), a new press gets an old id:
  silently lost then, refused as `id_reused` once P6 landed. Whether a tab name survives a reload was
  not written down.
- **Tickets had no settled id:** `#7` in text, `tracker/ticket/<n>` in streams, `demlik-1` marked a
  guess, `t-41` in one sketch.

## The known way

Each quote was fetched on 2026-11-07 unless marked **from memory**.

- **SQLite numbers** ([autoinc](https://www.sqlite.org/autoinc.html)). Without `AUTOINCREMENT` a new
  rowid is "one larger than the largest ROWID in the table prior to the insert", so "ROWIDs from
  previously deleted rows might be reused". With it, rowids "have never been used before by the same
  table" and are "monotonically increasing" but not sequential, at a cost: it "imposes extra CPU,
  memory, disk space, and disk I/O overhead and should be avoided if not strictly needed", keeping
  the top number in `sqlite_sequence`. For us: an append-only table never reuses a number with a
  plain `INTEGER PRIMARY KEY`.
- **Durable Objects and `AUTOINCREMENT`.** Cloudflare's SQL storage page names no rule against it,
  does not mention `sqlite_sequence`, and names one hidden table, `__cf_kv`
  ([SQL storage](https://developers.cloudflare.com/durable-objects/api/sql-storage/)). Experiment
  174 used `AUTOINCREMENT` in local workerd only; not seen on Cloudflare.
- **Stripe's prefixes** ([object IDs](https://dev.to/stripe/designing-apis-for-humans-object-ids-3o5a)):
  "adding a prefix makes the ID human readable" (`pi_3LKQhvGUcADgqoEM3bh6pslE`); a wrong kind is
  spotted "without even looking at the code"; a field that takes several kinds knows "which table to
  query"; and "writing a regex to filter out accidental leaks is trivial".
- **TypeID** ([jetify-com/typeid](https://github.com/jetify-com/typeid), spec v0.3): "A type prefix
  (at most 63 characters in all lowercase snake_case ASCII [a-z_])", "An underscore '_' separator",
  "A 128-bit UUIDv7 encoded as a 26-character string". Prefix regex
  `^([a-z]([a-z_]{0,61}[a-z])?)?$`; apps "SHOULD use a prefix that is at least 3 characters long",
  so `in` is too short and `input` fits. "You can't accidentally use a `user` ID where a `post` ID
  is expected"; "K-sortable" with "good locality"; selectable "by double-clicking", which a dash
  breaks. Alphabet `0123456789abcdefghjkmnpqrstvwxyz`; the first character is 0 to 7.
- **UUIDv7** ([RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html)): 48-bit Unix milliseconds,
  4 version bits, 12 random bits, 2 variant bits, 62 random bits; designed so implementations "sort
  as opaque raw bytes". 6.12: "treat UUIDs as opaquely as possible". Section 8: "Implementations
  SHOULD NOT assume that UUIDs are hard to guess", so a made id is never a secret.
- **ULID** ([ulid/spec](https://github.com/ulid/spec)): 48-bit milliseconds, 80 random bits, "26
  character string" in "Crockford's base32", "Lexicographically sortable"; within a millisecond the
  random part "is incremented by 1 bit". TypeID is UUIDv7 in ULID's alphabet.
- **Snowflake** ([2010 README](https://github.com/twitter-archive/snowflake/tree/snowflake-2010)):
  "machines generating ids should not have to coordinate with each other"; "time - 41 bits",
  "configured machine id - 10 bits", "sequence number - 12 bits"; the same shape as fix (a).
- **Numbers people type.** GitHub: an issue has `id`, `node_id` and `number`, "The number that
  identifies the issue", and "GitHub's REST API considers every pull request an issue"
  ([issues API](https://docs.github.com/en/rest/issues/issues)); our own #193 reads
  `{"id": 6114603227, "node_id": "PR_kwDOU7rok88AAAABLtPXtA", "number": 193}`. Linear: `ENG-123`;
  moving an issue to another team gives a new identifier and old ones keep resolving (*from a search
  summary of [Linear's docs](https://linear.app/docs/editing-issues); the page would not load*).
  That Linear issues also have a UUID, and that an issue made offline gets its number when it syncs,
  is **from memory**.

## One outside event under two ids

A webhook delivered twice is two arrivals, so the door rightly stamps two input ids. The repeat
must be caught on the source's key.

- **GitHub:** `X-GitHub-Delivery` is "A globally unique identifier (GUID) to identify the event"
  and `X-GitHub-Hook-ID` "The unique identifier of the webhook"
  ([events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)); on a
  redelivery "the `X-GitHub-Delivery` header will be the same as in the original delivery"
  ([best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)).
  So the key is (hook, delivery).
- **Stripe:** "Webhook endpoints might occasionally receive the same event more than once. You can
  guard against duplicated event receipts by logging the event IDs you've processed", and "In some
  cases, two separate Event objects are generated and sent. To identify these duplicates, use the
  ID of the object in `data.object` along with the `event.type`". Retries run "for up to three
  days", each re-signed ([Stripe webhooks](https://docs.stripe.com/webhooks)).
- **Idempotent consumer** ([microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html)):
  "record the IDs of processed messages in the database", in the same transaction as the work.
- **Kafka's idempotent producer** ([KIP-98](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging)):
  "Messages with a lower sequence number result in a duplicate error", inside one producer session;
  a stable `transactional.id` carries it across restarts. A key the receiver makes per arrival can
  never dedupe; only the sender's stable key can.

**Lean, 70%: dedupe in the ledger, on a letter id built from the source's key; the door does not
dedupe.** The letter id is `letter_` plus a UUIDv5 over `(system, scope, key)` (GitHub's hook and
delivery, Stripe's endpoint and `evt_`), and the entry keeps that `Source` so anyone can recompute
it. Only the ledger's append is one transaction with the "seen" record; a gateway sleeps and a
webhook may reach another gateway. Doubts: TypeID's spec says the suffix is a UUIDv7, so a v5 suffix
is in its encoding but outside its letter, and RFC 9562 6.13 warns against name-based UUIDs as
database keys. Stripe's "two separate Event objects" are each source's adapter's job.

## What was decided

- [One id per thing](../.decisions/0211-one-typeid-per-thing.md), 2026-11-07: every thing has one TypeID,
  `<type>_<UUIDv7 in 26 base32>`, made with `Id.make`; a thing people count also gets `n:
  Schema.Int`, printed only by its owning program. **The study's "kind 1, a number in place of an
  id" did not survive:** a ticket is `ticket_…` with `n: 193` beside it, not `{ticket: 41}` alone.
- On 2026-11-08 the owner made the input id a TypeID too (fix b), with the door's process and count
  kept as their own fields, not packed into the id.
- As of 2026-11-11 main's `next/packages/libfabrika/src/Id.ts` makes `Input`, `Letter` and `Cmd`
  ids with `make`, and the gateway takes input ids from it (`gateway/Gateway.ts`). Whether every
  old `in-` shape is gone was not checked; two test files still build one.
- The prefix is the type, not the program (`ticket_`, not `tracker_`), as the study leaned; the
  note uses the type.
- Not decided by the note: derived ids, and the outside-event dedupe above.

## What it cannot tell us

- How often a door object really starts; 500 to 3,000 a day is a guess.
- Whether `AUTOINCREMENT` and `sqlite_sequence` work on Cloudflare; the docs are silent.
- Whether workerd's random source is good enough; that `crypto.getRandomValues` is a CSPRNG on
  Cloudflare is **from memory**.
- How Linear numbers offline issues: a search summary and memory only.
- Whether a tab's name survives a reload, which decides whether old letter ids could repeat.
- Nothing ran on the real code: no test, build or typecheck of the sketches.
