// Who belongs, as a service: it reads and writes `door/members` and folds it with `Access.ts`'s one
// rule (p96, p97). Tier 1, P9. It never verifies a signature: the door checks SSHSIG at wiring, then
// calls `write`.
//
// `write` folds, refuses what the rule refuses (writing nothing), else appends under the event's own
// id and folds on to the new rev. The second fold is the honest answer to a race: two Macs typing
// one stolen sheet at once both pass the first check, the log puts one first, and the other hears
// `ignored used`, never "you are in".
import { Context, Effect, Layer, Result, Schema, Stream } from "effect";
import { Ledger, LedgerError } from "../ledger/Ledger.ts";
import { Appended, type Entry, fromHere, lineFor, valueFor } from "../ledger/Log.ts";
import type { From } from "../processes/Mailbox.ts";
import { Rev } from "../Rev.ts";
import { short } from "../telemetry/Trace.ts";
import { allows, EMPTY, eventId, type Folded, MemberEvent, type Members, signedBy, subject, Reason } from "./Access.ts";

/** The stream who belongs is kept on. */
const MEMBERS = "door/members";

/** What the founding screen gives: the name, the first person keys, and the first window. */
export const Founder = Schema.Struct({
  name: Schema.String,
  keys: Schema.Array(Schema.String),
  window: Schema.NullOr(Schema.String),
});
export type Founder = typeof Founder.Type;

/** What `write` answers. */
export const Written = Schema.TaggedUnion({
  /** In the log, and the fold takes it. */
  applied: { rev: Rev },
  /** In the log, but an earlier event won the race (flag 6). */
  ignored: { rev: Rev, reason: Reason },
  /** Nothing written: the rule's reason, or the ledger's own. */
  refused: { reason: Schema.Union([Reason, Appended.cases.refused.fields.reason]) },
});
export type Written = typeof Written.Type;

const tag = (word: string): string => `fab.members.${word}`;

const known: ReadonlySet<string> = new Set(Object.keys(MemberEvent.cases));
const decodeEvent = Schema.decodeUnknownResult(MemberEvent);

/** One entry of `door/members` and the event it holds; a case this piece does not know is none. */
type Row = { readonly entry: Entry; readonly event: MemberEvent | null };

/** The fold of a read, with the reason of each event it skipped, by rev. */
type Replayed = {
  readonly rows: ReadonlyArray<Row>;
  readonly folded: Folded;
  readonly skipped: ReadonlyMap<Rev, Reason>;
  /** The rev of the stream's newest entry, 0 when it is empty. */
  readonly head: Rev;
};

const row = Effect.fnUntraced(function* (entry: Entry) {
  if (!known.has(entry._tag)) {
    return { entry, event: null } satisfies Row;
  }

  const event = decodeEvent(valueFor(entry));

  if (Result.isFailure(event)) {
    return yield* new LedgerError({ reason: "bad_row" });
  }

  return { entry, event: event.success } satisfies Row;
});

const replay = (rows: ReadonlyArray<Row>): Replayed => {
  const skipped = new Map<Rev, Reason>();
  let folded = EMPTY;

  for (const { entry, event } of rows) {
    if (event === null) {
      continue;
    }

    const next = allows(folded, event);

    if (Result.isSuccess(next)) {
      folded = next.success;
    } else {
      skipped.set(entry.rev, next.failure);
    }
  }

  return { rows, folded, skipped, head: rows.at(-1)?.entry.rev ?? 0 };
};

const view = ({ folded, skipped, rows }: Replayed) => ({
  [tag("events")]: rows.length,
  [tag("keys")]: folded.members.keys.size,
  [tag("live")]: [...folded.members.keys.values()].filter((k) => k.live).length,
  [tag("ignored")]: skipped.size,
});

export class ClientManager extends Context.Service<
  ClientManager,
  {
    readonly members: Effect.Effect<Members, LedgerError>;
    readonly write: (event: MemberEvent, from: From) => Effect.Effect<Written, LedgerError>;
  }
>()("@kampus/libfabrika/ClientManager") {
  /** Building it writes nothing. The first call on an empty `door/members` writes `founded` under
   *  the fixed id `founded`, inside that call's error channel, so the referee keeps it once (p20). */
  static readonly layer = (
    founder: Founder & {
      /** The person the founder works for: `founded`'s `for`, and its event's id. */
      readonly person: string;
      /** The founder's checked key, which signs `founded`: `by`, never the person. */
      readonly by: string;
      /** The build of the code that writes `founded` (H6). */
      readonly build: string;
    },
  ): Layer.Layer<ClientManager, never, Ledger> =>
    Layer.effect(
      ClientManager,
      Effect.gen(function* () {
        const ledger = yield* Ledger;
        const founding = MemberEvent.cases.founded.make({
          id: founder.person,
          name: founder.name,
          keys: founder.keys,
          window: founder.window,
        });

        const read = Stream.runCollect(ledger.read(MEMBERS, 0)).pipe(
          Effect.flatMap((entries) => Effect.forEach(entries, row, { concurrency: 1 })),
          Effect.map(replay),
        );

        /** The stream folded, after `founded` is in it. */
        const load = Effect.gen(function* () {
          const first = yield* read;

          if (first.rows.length > 0) {
            return first;
          }

          const { by, person, build } = founder;
          // Both callers, members.read and members.write, already own a span.
          const from = yield* fromHere({ by, for: person, seen: 0, parent: null, build }).pipe(Effect.orDie);
          // Two first calls at once write the same line under one id: the referee keeps one,
          // and the other hears `id_reused` and reads what the first wrote. Any other refusal
          // fails: a stream with no `founded` would start with no members.
          const placed = yield* ledger.append(MEMBERS, "founded", lineFor(from, founding));

          if (placed._tag === "refused" && placed.reason !== "id_reused") {
            return yield* new LedgerError({
              reason: "refused",
              message: `founded refused: ${placed.reason}`,
            });
          }

          return yield* read;
        });

        const answer = Effect.fnUntraced(function* (written: Written) {
          yield* Effect.annotateCurrentSpan({
            [tag("answer")]: written._tag,
            ...Written.match(written, {
              applied: ({ rev }) => ({ [tag("rev")]: rev }),
              ignored: ({ rev, reason }) => ({ [tag("rev")]: rev, [tag("reason")]: reason }),
              refused: ({ reason }) => ({ [tag("reason")]: reason }),
            }),
          });
          return written;
        });

        const write = Effect.fn("members.write")(
          function* (event: MemberEvent, from: From) {
            yield* Effect.annotateCurrentSpan(
              short({
                [tag("tag")]: event._tag,
                [tag("id")]: eventId(event),
                ...nonNull(tag("signer"), signedBy(event)),
                ...nonNull(tag("key"), subject(event)),
              }),
            );
            const before = yield* load;
            const id = eventId(event);

            // An event already in the log goes to the referee as it is: a resend gets its first
            // placing, and the answer is what the fold did with it then.
            if (!before.rows.some(({ entry }) => entry.id === id)) {
              const verdict = allows(before.folded, event);

              if (Result.isFailure(verdict)) {
                return yield* answer(Written.cases.refused.make({ reason: verdict.failure }));
              }
            }

            const placed = yield* ledger.append(MEMBERS, id, lineFor({ ...from, seen: before.head }, event));

            if (placed._tag === "refused") {
              return yield* answer(Written.cases.refused.make({ reason: placed.reason }));
            }

            const reason = (yield* read).skipped.get(placed.rev);
            return yield* answer(
              reason === undefined
                ? Written.cases.applied.make({ rev: placed.rev })
                : Written.cases.ignored.make({ rev: placed.rev, reason }),
            );
          },
          Effect.tapError((error) => Effect.annotateCurrentSpan(tag("reason"), error.reason)),
        );

        const members = Effect.fn("members.read")(function* () {
          return yield* load.pipe(
            Effect.tap((replayed) => Effect.annotateCurrentSpan(view(replayed))),
            Effect.map(({ folded }) => folded.members),
            Effect.tapError((error) => Effect.annotateCurrentSpan(tag("reason"), error.reason)),
          );
        });
        return {
          members: members(),
          write,
        };
      }),
    );
}

const nonNull = (key: string, text: string | null): Record<string, string> => (text === null ? {} : { [key]: text });
