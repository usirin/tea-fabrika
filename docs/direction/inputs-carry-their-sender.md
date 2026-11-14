---
state: "direction decided 2026-11-04, details proposed; input ids decided 2026-11-08; walked 2026-11-08, question 17 approved"
summary: "Both versions, today's first. The host's door stamps every input as `Envelope<A> = {id, by, at, input}`, with `id` an `InputId` only the door makes; a client-sent id is refused. Every write names its `cause`, and the host signs it as that input's sender, so an agent signs its own writes and never the person's. The cause rides in the data (OTP's kept `From`, causation ids, Datomic), not by pairing a Cmd with its Msg. A write with no cause is the job owner's, and a test-kit law catches a program that forgets. Delegation, not impersonation (RFC 8693's `act`). Traces mirror it with span links and never decide. Not saved state's envelope. In `next/`, `Entry` gains `cause`. In `next/`, an `InputId` is a TypeID, `input_<26 chars>`, with the door's process and count as their own fields on the entry (decided 2026-11-08). From experiment 209."
---

# Inputs carry their sender, and every write carries its cause

Its decided rules are in: [0261](../../.decisions/0261-inputs-carry-their-sender.md), [0262](../../.decisions/0262-a-write-carries-parent-and-traceid.md), [0263](../../.decisions/0263-a-writes-signer-is-its-causes-sender.md).

**Proposed 2026-11-04.** Walked when Tier 1 starts (owner, 2026-11-08): P11's test-kit law in question 17, approved by the owner 2026-11-08. The owner set the direction on 2026-11-04, and each decided point is
marked decided below:

- **Renamed 2026-11-07 (owner):** the write's `cause` is now `parent`, and a `traceId` joins it.
  "Every write carries its cause" keeps its meaning: `parent` is the direct link, and it signs.
  `traceId` is the whole request, shown and checked for delivery only, never deciding. These are
  OpenTelemetry's names, which Effect's Tracer uses; in Effect, `cause` already means a failure.
  This settles the open point on an agent's stated reason below. The sketches keep the old word.

- **Decided, the direction:** inputs carry their sender, and the host ties each write to the input
  that caused it. This is design D of the shared tile study. The cause rides in the data, not in
  the call stack.
- **Decided, the shape:** the stamped input is `Envelope<A> = {id, by, at, input}`. In `next/` it is
  `{id, by, arrivedAt, input}`, since `next/` renamed the referee's clock (owner, 2026-11-05).
- **Decided, `cause` in `next/` (owner, 2026-11-05):** `next/`'s ledger `Entry` gets `cause` in
  Tier 1's P6, and the rest of this note lands in P10 and P11 ([where it
  lands](../plan/tier-1.md#where-inputs-carry-their-sender-lands)).
- **Decided, traces:** a trace mirrors the cause with an OpenTelemetry span link. A trace never
  decides who signs.
- **Decided, what goes:** the shared tile study's other way, a press in an agent's job running as
  the person's own one-shot job, is dropped. It hid a second `ticket` run behind the person.
- **Decided, record first:** who sent each input is recorded now, in the host log, before any write
  uses it.

Not walked yet: the test-kit law, Tier 1's open question 17. The open point on an agent's stated
reason (below) was decided 2026-11-07 as question 15.

- **Decided 2026-11-07 (owner), the signing service:** `SessionManager`, owned by the door, with
  `signer(parent, process, kind)` and the four refusals below. The door stamped every input, so it
  is the one authority on who sent it, as one gen_server owns a table in OTP. A process asks over
  one RPC. The doubt: one extra round trip per write; a cache would go stale.

Built from [experiment 209](../../experiments/209-talking-to-agents-in-place.md) and the shared
tile study behind it, and the Design canvas "Shared tile guidelines". Neither is a measurement.

```ts
// A sketch, today's version. The whole idea in one block.
// Every input past the host's door is stamped there. Nobody sends their own id or sender.
interface Envelope<A> {
	readonly id: InputId; // "in-3f9a0c21-41": the host run, then a count
	readonly by: Writer; // a person, or an agent for a person; from the connection
	readonly at: number; // the host's clock as it came, the referee's
	readonly input: A;
}

// Every write names the input that caused it. The host signs it as that input's sender.
// ticket #7, the owner's tile t1, claude summoned into it, claude's job 12 runs `ticket --ticket 7`
// in-3f9a0c21-41  by user:github:42               the owner presses Approve in job 12's window
//   -> tracker/ticket/7/inbox  {kind: "answered", writer: "user:github:42", cause: "in-3f9a0c21-41"}
// in-3f9a0c21-42  by agent:claude for:github:42   claude sends `tell %12 comment "plan v1 is up"`
//   -> tracker/ticket/7/inbox  {kind: "commented", writer: "agent:claude for:github:42",
//                               cause: "in-3f9a0c21-42"}
// one run, two writes, two signers: each write is its cause's sender's
```

## Which version

- **Today's version** (`packages/fabrika/src/host/`, `apps/fabrika`, `programs/`): this note.
  The envelope is made at the host's two doors, the app's link and the agents' link. The rows the
  tracker writes gain `cause`. Today's rows still say `kind`.
- **`next/`:** the same rule, at its door. Its ledger `Entry` (`next/src/data/log.ts` on
  [PR 223](https://github.com/usirin/tea-fabrika/pull/223)) has `at`, `by` and `said`, and no
  `cause`. **Decided by the owner, 2026-11-05: `cause` is added in Tier 1's P6,** since an entry
  written without it never gets it back. In `next/` the clocks are `arrivedAt` and `sentAt`
  (renamed the same day), so its envelope is `{id, by, arrivedAt, input}`. In `next/`'s words this
  note's host is the brain's door, a run is a process, and the cell is the runner. Each part's row
  and law are in [Tier 1's plan](../plan/tier-1.md#where-inputs-carry-their-sender-lands).
- **`next/`'s input id is a TypeID,** `input_<26 chars>`, not this note's `in-<host run>-<n>`.
  Decided by the owner, 2026-11-08, in [one id per thing](../../.decisions/0211-one-typeid-per-thing.md). The door's
  process and its count stay, as their own fields on the entry. The ids in this note's sketches
  are today's version's.

## The shape

```ts
// A sketch, today's version. In memory, made at the door.
import {type Brand, type Effect, Schema} from "effect";

/** One input's id, `in-<host run>-<n>`. Branded: no client sends one, nothing decodes one. */
export type InputId = string & Brand.Brand<"InputId">;

// What a row keeps: the cause as text. Read back for reading, never turned into an InputId.
const CauseText = Schema.String.check(Schema.isPattern(/^in-[0-9a-f]{8}-[1-9][0-9]*$/));

// A write a program asks the host to sign. `own` is the run's own write (a timer, a poll).
const Write = Schema.TaggedUnion({
	caused: {cause: CauseText, fact: Schema.Unknown},
	own: {fact: Schema.Unknown},
});
```

- **Why an interface, not a schema.** An envelope is made in memory at the door and never decoded
  from outside. A schema would invite something to parse one; the brand on `InputId` says the same.
- **The id.** Only the host's door makes it: `in-<host run>-<n>`. The host run is fresh at each host
  start, and `n` counts up in it, as Zed gives each replica an id and counts its operations ([Zed's
  CRDTs](https://zed.dev/blog/crdts)). So no id is made twice, across restarts too.
- **A client-sent id is refused.** A link that names its own `id` or `by` is broken or lying, and
  the refusal is recorded. Ignoring it would invite a later reader to trust the key. That is mass
  assignment (OWASP API Security Top 10 2023, API3). Decided in
  [0140](../../.decisions/0140-gateway-refuses-client-id-and-by.md): refused and counted in the
  gateway's hourly metric, never recorded, and a write with no cause is `own`.
- **`at` and not `said`.** `at` is the referee's clock, as the [glossary](../../.glossary/TERMS.md)
  says. No sender gives its own clock today; if one does later, it goes in `said`, kept out of the
  deciding code's types. In `next/` the two are `arrivedAt` and `sentAt`.
- **The cause is carried by the program, in its Msg, in any queue in its Model, and in the Cmd's
  input.** The program never carries the sender. The cell asks the host to sign "as whoever sent
  input X". The host looks X up in its own table.

```ts
// A sketch, today's version. The host's side. A service that holds many is `<Thing>Manager`.
interface SessionManager {
	/** The session to write one fact as, for one cause. Refused in words otherwise. */
	readonly signer: (cause: InputId, run: RunId, kind: string) => Effect.Effect<Session, Refused>;
}
// refused when:
//   the cause was never told to this run           a program cannot borrow another run's press
//   the cause is spent for this kind               one press, one `answered`
//   the kind is person-only and the cause's input  a person's comment cannot become
//     is not a person-only input sent by a person  an `answered` by a program's mistake
//   the run has ended                              a kept cause dies with its run
// a write with no cause: the job owner's session, as today
```

## Why the cause rides in the data

The host never sees `update`: a program's `main` runs tea itself. And our own tracker sends a
press's write from a later update: a queued write goes out from the earlier write's `save_ok`. So
pairing each Cmd with the Msg that made it gives the wrong signer.

```text
the owner presses "Request changes"  -> write w1, sender user        saving [w1]     -> save(w1)
claude: tell %12 close               -> write w2, sender agent:claude saving [w1, w2] -> no Cmd yet
save_ok w1                           -> settled -> sendFirst            -> save(w2)
pairing save(w2) with save_ok(w1)    => claude's close is signed as the person      silently wrong
```

Getting the pairing out of tea would also make tea grow, and tea stays small. In an Elm machine,
cause flows through the Model, so it rides in the Model.

## The known way

This is **delegation, not impersonation**. OAuth token exchange
([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)) names both: impersonation makes the agent
look like the person; delegation keeps both ids, the person in `sub` and the agent in `act`. Our
writer text already keeps both: `agent:claude for:github:42`. The cause adds the third fact, per
write: which input made it.

| Maker | What they do | What we take |
|---|---|---|
| Erlang/OTP | `handle_call(Request, From, State)`: `From` is made by the call. A server that answers later keeps `From` in its State ([gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)). | The sender comes from the channel. Deferred work carries it in data. |
| Event stores (causation id) | "CausationId ... is always the id of what ever directly caused the event/command", copied by the handler ([DDD/CQRS list](https://groups.google.com/g/dddcqrs/c/qGYC6qZEqOI)). Axon copies it into metadata by default ([Axon](https://docs.axoniq.io/axon-framework-reference/development/messaging-concepts/message-correlation/)). | The handler copies the cause forward, by hand. |
| Datomic | Attributes on the transaction itself, such as "the user who caused it" ([transaction data](https://docs.datomic.com/transactions/transaction-data-reference.html)). | Who caused a write is data on that write. |
| Zed | A replica id handed out centrally, plus a count, on every operation ([Zed's CRDTs](https://zed.dev/blog/crdts)). | Who made an edit is fixed where it is made. |
| Linear | An agent is a delegate; "humans maintain ownership while agents act on their behalf" ([agents](https://linear.app/developers/agents)). A person's message into an agent's session is a `prompt` activity, which an agent "cannot generate" ([agent interaction](https://linear.app/developers/agent-interaction)). | The person's act stays the person's, even inside the agent's work. |
| OpenTelemetry | Span links "imply a causal relationship" for work queued for later ([traces](https://opentelemetry.io/docs/concepts/signals/traces/)). Baggage has "no built-in integrity checks" ([baggage](https://opentelemetry.io/docs/concepts/signals/baggage/)). | A trace links a write to its cause. A link never signs. |

**The public failure is the case we avoid.** GitHub's Copilot coding agent becomes the main commit
author on a squash merge, and the person who asked disappears
([discussion 179983](https://github.com/orgs/community/discussions/179983)). The opposite failure
is also reported: an agent on a person's token shows in audit logs as the person
([Ory](https://www.ory.com/blog/audit-log-says-service-acount-did-it)). An agent signs its own
writes, and never the person's.

## The case nobody listed

A program that forgets to carry the cause. Its write falls back to the job owner, so a person's
comment in claude's run would be signed by claude. That is not a forgery, but it is wrong, and
nothing errors.

- **What holds it:** a law in the program test kit. For any input told by sender S, every write it
  causes is signed S. Random inputs, both senders, interleaved, across queued writes.
- **The "I don't know" exit:** a write with no cause is the job owner's, said as `own` in the
  data, never guessed.
- **What it does not make expensive:** an honest program pays one field per Msg it queues.

## Decided: an agent's stated reason

**Decided 2026-11-07 (owner):** two links, named `parent` and `traceId`, as the lean below had it.
The stated reason is the `traceId`, the request the person's message started.

The walk's notes say claude's lines, run because the person asked `@claude ...`, carry the
person's message as their cause. The signing rule says a write is signed by its cause's sender. Both
cannot hold: that would sign claude's lines as the person.

- **Lean (70%):** two links, as event stores keep two ids. `cause` is the direct one, and it signs:
  claude's line is claude's own input, so its writes are claude's. The person's message rides on
  claude's line as its stated reason, a second key (`asked` in this sketch). The host checks only
  that the message was delivered to that agent. It is recorded and shown ("you asked, claude ran
  this"), and never decides.
- **What would settle it:** the owner's call on the second key's name and on whether a reason the
  agent states is worth keeping at all.

## Record first

The first build records each envelope in the host log, with no change in behavior (decided
2026-11-04). It logs who sent each input and where it went, never what a raw key said. A typed
value is logged through its schema, with a `Redacted` value hidden
([secrets are redacted](./secrets-are-redacted.md)).

## Name clash: two envelopes

[Saved state](./saved-state.md) already says "envelope" for a ledger entry's wrapper (D3's `by`,
`said`, `at`, and `seen`; in `next/`, `by`, `sentAt`, `arrivedAt`, `seen` and now `cause`). That is the Ledger context. This envelope is a stamped input at the
host's door, the Runtime context. The glossary keys it `envelope (runtime)`, and the context map
says how the two meet: an input's envelope causes a write; the write's entry has its own envelope,
which now names the cause.

## What it undoes

- **Plan 185b PR 2's words** ([PR 378](https://github.com/usirin/tea-fabrika/pull/378)): "one
  writer per job" becomes "one owner per job, one signer per write". Its guard stays: a job never
  goes on as another writer, and attach across writers is refused.
- **The person-only walls stay** as they are: an agent's list has no `answer`, `mayWrite` refuses,
  and the door refuses a person-only kind from an agent's session.

## What it costs

A guess from reading, about 300 to 450 lines with tests in today's version: the envelope at both
doors (about 120), an opaque cause handed to the handler (about 40), `ticket` and the tracker carry
it (about 30; today only these two take a person's writes), the `SessionManager` (about 100),
`saveTicket` signs per write (about 20), rows gain `cause`, and the law. About 0.5 to 0.75 agent
hours at 600 lines an hour ([agent hours](./agent-hours.md)). Sure of the size: 50%. Sure the build
holds once made: 70%, since every program that writes must carry the cause, and the safe default
misattributes rather than fails. The law settles that doubt.

## Made up here

`InputId`'s exact pattern, `CauseText`, `Write` and its two cases, `SessionManager` and `signer`,
`asked`, the id `in-3f9a0c21-41`, the account number in `user:github:42`, the `commented` kind, and
every trace line's text.

## What it cannot tell us

- Nothing ran. The line counts are guesses.
- Only `ticket` and the tracker were read for queues in the Model. Other programs that write may
  queue too.
- A run with kept state restores its Model but not the host's cause table, so a queued press is lost
  across a restart. The tracker keeps none; others may.
- "The app's link is the person" holds for one person on one app. Two people on one desk break the
  stamp, and with it everything here. That is a later study.
- The door cannot check a cause. The row records it now, so a later step can: the page could sign
  its own press, as Linear's server records a prompt.
