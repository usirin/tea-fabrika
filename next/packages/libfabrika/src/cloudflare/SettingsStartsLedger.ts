import { DateTime, Effect, Equal, Layer, Schema } from "effect";
import { Digest } from "effect/crypto";
import { Doorbell } from "../ledger/Ledger.ts";
import { Appended, type Entry, lineFor } from "../ledger/Log.ts";
import { Referee } from "../ledger/Referee.ts";
import * as RefereeSql from "../ledger/RefereeSql.ts";
import * as Start from "../settings/Start.ts";
import { Decode, Missing, MissingTarget, Refused, Starts, StartsError, Storage } from "../settings/Starts.ts";
import type { Sql } from "../Sql.ts";
import * as SettingsInput from "./SettingsInput.ts";

const storage = (cause: unknown) => new StartsError({ reason: new Storage({ cause }) });
const decode = (cause: unknown) => new StartsError({ reason: new Decode({ cause }) });
const event = Schema.TaggedStruct("instance_started", Start.Body.fields);
const stream = (start: string) => `settings/instance/${start}`;

const saved = Effect.fnUntraced(function* (entry: Entry, start: string) {
  const body = yield* Schema.decodeUnknownEffect(Start.Body)(entry.body, { onExcessProperty: "error" }).pipe(
    Effect.mapError(decode),
  );
  yield* SettingsInput.check({
    settings: body.settings,
    start: body.start,
    build: body.build,
    repo: body.repo,
    founding: { person: entry.for, founder: "ledger", window: null },
    name: "ledger",
  }).pipe(Effect.mapError(decode));

  if (
    entry.id !== start ||
    body.start !== start ||
    entry.stream !== stream(start) ||
    entry._tag !== "instance_started"
  ) {
    return yield* decode("Conflicting instance start");
  }

  const { id, rev, pos, arrivedAt, by, for: person, sentAt, seen, parent, traceId } = entry;
  return yield* Schema.decodeUnknownEffect(Start.Receipt)({
    ...body,
    entry: { id, stream: entry.stream, rev, pos, arrivedAt, by, for: person, sentAt, seen, parent, traceId },
  }).pipe(Effect.mapError(decode));
});

/** Uses the same referee and write coordination as full Project construction. */
export const fromLedger = () =>
  Layer.effect(
    Starts,
    Effect.gen(function* () {
      const ledger = yield* Referee;
      const lookup = (start: string) => ledger.read(stream(start), 0, "settings").pipe(Effect.mapError(storage));
      const read = Effect.fnUntraced(function* (start: string) {
        yield* Schema.decodeUnknownEffect(Start.Input.fields.start)(start).pipe(Effect.mapError(decode));
        const entries = yield* lookup(start);
        const entry = entries[0];

        if (entry === undefined) {
          return yield* new StartsError({
            reason: new Missing({ target: MissingTarget.cases.instance.make({ start }) }),
          });
        }

        if (entries.length !== 1) {
          return yield* decode("Conflicting instance stream");
        }

        return yield* saved(entry, start);
      });
      const record = Effect.fnUntraced(function* (input: Start.Input) {
        const checked = yield* SettingsInput.check(input).pipe(Effect.mapError(decode));
        const body = Start.Body.make({
          start: input.start,
          settings: checked.snapshot,
          build: input.build,
          repo: input.repo,
        });
        const entries = yield* lookup(input.start);

        const first = entries[0];

        if (first !== undefined) {
          const receipt = yield* saved(first, input.start);
          const { entry: _entry, ...original } = receipt;
          const { id: _id, stream: _stream, rev: _rev, pos: _pos, arrivedAt: _at, ...origin } = receipt.entry;

          if (
            entries.length !== 1 ||
            !Equal.equals(original, body) ||
            (input.origin !== undefined && !Equal.equals(origin, input.origin))
          ) {
            return yield* new StartsError({ reason: new Refused({ cause: "Conflicting instance start" }) });
          }

          return receipt;
        }

        const origin =
          input.origin ??
          Start.Origin.make({
            by: `instance:${input.start}`,
            for: input.founding.person,
            sentAt: DateTime.formatIso(yield* DateTime.now),
            seen: 0,
            parent: null,
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          });
        const line = lineFor({ ...origin, build: input.build }, event.make(body));
        const reply = yield* ledger.append(stream(input.start), input.start, line).pipe(Effect.mapError(storage));
        const ack = yield* Schema.decodeUnknownEffect(Appended)(reply).pipe(Effect.mapError(decode));

        if (ack._tag !== "placed") {
          return yield* new StartsError({ reason: new Refused({ cause: ack }) });
        }

        const receipt = yield* read(input.start);

        if (receipt.entry.rev !== ack.rev || receipt.entry.pos !== ack.pos) {
          return yield* decode("Invalid append acknowledgement");
        }

        return receipt;
      });
      return {
        record: (input: Start.Input) => record(input).pipe(Effect.provide(Digest.layerWebCrypto)),
        read: (start: string) => read(start).pipe(Effect.provide(Digest.layerWebCrypto)),
      };
    }),
  );

export const layer = (sql: Sql) =>
  fromLedger().pipe(
    Layer.provide(RefereeSql.layer(sql)),
    Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
  );
