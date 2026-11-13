import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Effect, Equal, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as Codec from "../settings/Codec.ts";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";
import * as Start from "../settings/Start.ts";
import { Decode, StartsError } from "../settings/Starts.ts";

export const check = Effect.fnUntraced(function* (raw: unknown) {
  const input = yield* Schema.decodeUnknownEffect(Start.Input)(raw, { onExcessProperty: "error" });
  // Preserve the shared decoder's own failure for existing app error boundaries.
  const values = Object.fromEntries(
    Object.entries(Declarations.all.settings).map(([name, declaration]) => [
      name,
      input.settings.values[declaration.path],
    ]),
  );
  yield* Schema.decodeUnknownEffect(Codec.values(Declarations.all))(values, { onExcessProperty: "error" });
  const checked = yield* Snapshot.read(Declarations.all, input.settings);
  return { input, ...checked };
});

export const decode = Effect.fnUntraced(function* (encoded: unknown) {
  const input = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Start.Input))(encoded, {
    onExcessProperty: "error",
  });
  return yield* check(input);
}, Effect.provide(Digest.layerWebCrypto));

export const receipt = Effect.fnUntraced(function* (raw: unknown, expected?: Start.Input) {
  const saved = yield* Schema.decodeUnknownEffect(Start.Receipt)(raw, { onExcessProperty: "error" });
  yield* Snapshot.read(Declarations.all, saved.settings);

  const { entry, ...body } = saved;
  const { id: _id, stream: _stream, rev: _rev, pos: _pos, arrivedAt: _at, ...origin } = entry;

  if (
    entry.id !== saved.start ||
    entry.stream !== `settings/instance/${saved.start}` ||
    (expected !== undefined &&
      (!Equal.equals(body, {
        start: expected.start,
        settings: expected.settings,
        build: expected.build,
        repo: expected.repo,
      }) ||
        (expected.origin !== undefined && !Equal.equals(origin, expected.origin))))
  ) {
    return yield* new StartsError({ reason: new Decode({ cause: "Invalid instance receipt" }) });
  }

  return saved;
}, Effect.provide(Digest.layerWebCrypto));

export const read = Effect.gen(function* () {
  const env = yield* WorkerEnvironment;
  return yield* decode(env.INSTANCE).pipe(
    Effect.mapError((cause) => new StartsError({ reason: new Decode({ cause }) })),
  );
});
