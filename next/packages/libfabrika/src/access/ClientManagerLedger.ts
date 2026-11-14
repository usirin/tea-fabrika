/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
/**
 * The `ClientManager` kept on the ledger stream `gateway/access`.
 *
 * **Details**
 *
 * Every call reads the whole stream from the start and folds it, so the view is always what the
 * log says now. Entries whose tag is not a membership event are skipped, and an entry that does
 * not decode fails the call with a `LedgerError` of reason `bad_row`.
 *
 * @stability unstable
 */
import { Effect, Layer, Result, Schema, Stream } from "effect";
import { Ledger, LedgerError } from "../ledger/Ledger.ts";
import { type Entry, fromHere, lineFor, valueFor } from "../ledger/Log.ts";
import type { From } from "../processes/Mailbox.ts";
import type { Rev } from "../Rev.ts";
import { short } from "../telemetry/Trace.ts";
import type { Access, Folded, Reason } from "./Access.ts";
import { eventId, MemberEvent, members, signedBy, subject } from "./Access.ts";
import { allows, EMPTY } from "./AccessFold.ts";

import { ClientManager, Written, type Founder } from "./ClientManager.ts";

const MEMBERS = "gateway/access";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const tag = (word: string): string => `fab.access.${word}`;

const known: ReadonlySet<string> = new Set(Object.keys(MemberEvent.cases));
const decodeEvent = Schema.decodeUnknownResult(MemberEvent);

/** One entry of `gateway/access` and the event it holds; a case this piece does not know is none. */
type Row = { readonly entry: Entry; readonly event: MemberEvent | null };

/** The fold of a read, with the reason of each event it skipped, by rev. */
type Replayed = {
  readonly rows: ReadonlyArray<Row>;
  readonly folded: Folded;
  readonly skipped: ReadonlyMap<Rev, Reason>;
  /** The rev of the stream's newest entry, 0 when it is empty. */
  readonly head: Rev;
};

const row = Effect.fnUntraced(function* (entry: Entry) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  if (!known.has(entry._tag)) {
    return { entry, event: null } satisfies Row;
  }

  const event = decodeEvent(valueFor(entry));

  if (Result.isFailure(event)) {
    return yield* new LedgerError({ reason: "bad_row", cause: event.failure });
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

/** Who belongs after a read: the machine's public view. */
const current = ({ folded }: Replayed): Access => members(folded);

const view = (replayed: Replayed) => {
  const { rows, skipped } = replayed;
  const { keys } = current(replayed);
  return {
    [tag("events")]: rows.length,
    [tag("keys")]: keys.size,
    [tag("live")]: [...keys.values()].filter((k) => k.live).length,
    [tag("ignored")]: skipped.size,
  };
};

/**
 * Layer that provides `ClientManager` on top of the `Ledger`, founding the stream on first use.
 *
 * **Details**
 *
 * Building it writes nothing. The first call on an empty `gateway/access` writes `founded` under
 * the fixed id `founded`, inside that call's error channel, so the referee keeps it once. Two
 * first calls at once write the same line, and the one that hears `id_reused` reads what the other
 * wrote. `write` checks the event against the membership read first and answers `refused` without
 * writing when the rule says no. An event whose id is already in the log goes to the ledger as it
 * is, so a resend gets its first placing. After a write it reads again: an event the fold skips
 * answers `ignored`, else `applied`. Calls carry the spans `access.read` and `access.write`.
 *
 * **Gotchas**
 *
 * If the founding is refused for any reason but `id_reused`, the call fails with a `LedgerError`
 * of reason `refused`, since a stream with no `founded` would start with no members.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (
  founder: Founder & {
    /** The person the founder works for: `founded`'s `for`, and its event's id. */
    readonly person: string;
    /** The founder's checked key, which signs `founded`: `by`, never the person. */
    readonly by: string;
    /** The build of the code that writes `founded`. */
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
        // Both callers, access.read and access.write, already own a span.
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

      const write = Effect.fn("access.write")(
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

      const members = Effect.fn("access.read")(function* () {
        return yield* load.pipe(
          Effect.tap((replayed) => Effect.annotateCurrentSpan(view(replayed))),
          Effect.map(current),
          Effect.tapError((error) => Effect.annotateCurrentSpan(tag("reason"), error.reason)),
        );
      });
      return {
        members: members(),
        write,
      };
    }),
  );

const nonNull = (key: string, text: string | null): Record<string, string> => (text === null ? {} : { [key]: text });
