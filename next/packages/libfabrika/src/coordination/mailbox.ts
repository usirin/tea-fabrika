// The mailbox: a letter goes into a name's inbox once per id, and comes back out as a `Letter`, in
// order. Delivery is at least once, made safe by the id (C2, D4): a resend is one line. Tier 1, P9
// (law p21, p97). An inbox is the stream `<name>/inbox` on P6's ledger.
import { Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { Ledger, LedgerError } from "../data/ledger.ts";
import { Appended, type Entry, type Line, lineFor, type Rev } from "../data/log.ts";
import { short } from "../data/trace.ts";
import { brainOnly, inRunnerSpace } from "./process.ts";

/** Internal permission for a runner to save its own answers and alarm letters. */
export class RunnerMail extends Context.Service<RunnerMail, { readonly process: string; readonly name: string }>()(
  "@kampus/libfabrika/RunnerMail",
) {}

/** What a writer says about itself, shared by every write in this layer: P6's `Line` without its
 *  case and body, so a writer can leave none out (p92). */
export type From = Omit<Line, "_tag" | "body">;

/** A letter as it comes out of an inbox: what was asked, by whom, for whom, and where it sits. */
export type Letter = {
  readonly id: string;
  readonly m: unknown;
  readonly by: string;
  readonly for: string;
  readonly sentAt: string;
  readonly parent: string | null;
  readonly traceId: string;
  readonly rev: Rev;
  readonly pos: Rev;
};

/** A letter with what its entry also kept: the writer's build, the rev it had seen, and the
 *  referee's clock. The runner reads these to catch a process up (P11); `Letter` stays as it is. */
export type History = Letter & {
  readonly build: string;
  readonly seen: Rev;
  readonly arrivedAt: number;
};

/** Span tag keys: OpenTelemetry's messaging names where they fit, `fab.<thing>.*` for the rest. */
const STREAM = "messaging.destination.name";
const ID = "messaging.message.id";
const OPERATION = "messaging.operation.type";
const tag = (word: string): string => `fab.mailbox.${word}`;

/** A letter's line: its case, and its body `{m}`. */
const SEND = "send";
const Sent = Schema.Struct({ m: Schema.Json });
const Send = Schema.TaggedStruct(SEND, Sent.fields);
const decodeJson = Schema.decodeUnknownOption(Schema.Json);
const decodeSent = Schema.decodeUnknownOption(Sent);

const inbox = (name: string): string => `${name}/inbox`;

/** A `send` entry as its History; any other case is none, and kept in the log (T4). */
const history = Effect.fnUntraced(function* (entry: Entry) {
  if (entry._tag !== SEND) {
    return Option.none<History>();
  }

  const sent = decodeSent(entry.body);

  if (Option.isNone(sent)) {
    return yield* new LedgerError({ why: "bad_row" });
  }

  return Option.some<History>({
    id: entry.id,
    m: sent.value.m,
    by: entry.by,
    for: entry.for,
    sentAt: entry.sentAt,
    parent: entry.parent,
    traceId: entry.traceId,
    rev: entry.rev,
    pos: entry.pos,
    build: entry.build,
    seen: entry.seen,
    arrivedAt: entry.arrivedAt,
  });
});

/** A History as the Letter P9 answers: the same entry, without what only the runner reads. */
const letter = ({ build: _build, seen: _seen, arrivedAt: _arrivedAt, ...plain }: History): Letter => plain;

/** Tags an answer on the current span: placed or refused, and why. */
export const answered = Effect.fnUntraced(function* (word: (name: string) => string, answer: Appended) {
  yield* Effect.annotateCurrentSpan(
    Appended.match(answer, {
      placed: ({ rev, pos }) => ({
        [word("answer")]: "placed",
        [word("rev")]: rev,
        [word("pos")]: pos,
      }),
      refused: ({ why }) => ({ [word("answer")]: "refused", [word("why")]: why }),
    }),
  );
});

/** Tags a failure's why on the current span. */
export const failed = (word: (name: string) => string) =>
  Effect.fnUntraced(function* (error: LedgerError) {
    yield* Effect.annotateCurrentSpan(word("why"), error.why);
  });

export class Mailbox extends Context.Service<
  Mailbox,
  {
    readonly send: (to: string, id: string, m: unknown, from: From) => Effect.Effect<Appended, LedgerError>;
    /** The letters in `<name>/inbox` past the log rev `after`, oldest first. */
    readonly receive: (name: string, after: Rev) => Stream.Stream<Letter, LedgerError>;
    /** The same letters as `receive`, each with its entry's build, seen and arrival clock. */
    readonly read: (name: string, after: Rev) => Stream.Stream<History, LedgerError>;
  }
>()("@kampus/libfabrika/Mailbox") {
  /** Building it touches nothing: each call reaches the ledger on its own. */
  static readonly layer: Layer.Layer<Mailbox, never, Ledger> = Layer.effect(
    Mailbox,
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      /** The one reader under both reads: each `send` entry past `after`, counted on its span. */
      const reader = (name: string, after: Rev, span: string) =>
        Stream.unwrap(
          Effect.sync(() => {
            const count = { letters: 0, skipped: 0 };
            return ledger.read(inbox(name), after).pipe(
              Stream.mapEffect((entry) =>
                Effect.map(history(entry), (found) => {
                  if (Option.isSome(found)) {
                    count.letters++;
                  } else {
                    count.skipped++;
                  }

                  return Option.toArray(found);
                }),
              ),
              Stream.flattenIterable,
              Stream.onExit(() =>
                Effect.annotateCurrentSpan({
                  [tag("letters")]: count.letters,
                  [tag("skipped")]: count.skipped,
                }),
              ),
            );
          }),
        ).pipe(
          Stream.withSpan(span, {
            attributes: {
              ...short({ [STREAM]: inbox(name), [tag("name")]: name }),
              [OPERATION]: "receive",
              [tag("after")]: after,
            },
          }),
        );
      return {
        send: Effect.fn("mailbox.send")(
          function* (to: string, id: string, m: unknown, from: From) {
            yield* Effect.annotateCurrentSpan({
              ...short({ [STREAM]: inbox(to), [ID]: id, [tag("to")]: to }),
              [OPERATION]: "send",
            });
            // Mail never takes a stream or an id only the brain writes.
            const runner = yield* Effect.serviceOption(RunnerMail);
            const own = Option.exists(
              runner,
              (r) => r.name === to && id.startsWith(`${r.process}/`) && inRunnerSpace(id),
            );

            if (brainOnly({ stream: inbox(to), id: own ? "" : id, tag: SEND })) {
              return Appended.cases.refused.make({ why: "forbidden" });
            }

            const json = decodeJson(m);

            // The ledger's own answer for a body that is not JSON, without the trip.
            if (Option.isNone(json)) {
              return Appended.cases.refused.make({ why: "bad_line" });
            }

            return yield* ledger.append(inbox(to), id, lineFor(from, Send.make({ m: json.value })));
          },
          Effect.tap((answer) => answered(tag, answer)),
          Effect.tapError(failed(tag)),
        ),
        receive: (name, after) => reader(name, after, "mailbox.receive").pipe(Stream.map(letter)),
        read: (name, after) => reader(name, after, "mailbox.read"),
      };
    }),
  );
}
