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
 * Decoding and checks for a start's input and its receipt, as a Worker or an object reads them
 * from the `INSTANCE` binding and from RPC replies.
 *
 * @stability unstable
 */
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Effect, Equal, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as Codec from "../settings/Codec.ts";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import * as Start from "../settings/Start.ts";
import { Decode, StartsError } from "../settings/Starts.ts";

/**
 * Decodes a raw value as a start's input and checks its settings.
 *
 * **Details**
 *
 * The input may hold no unknown field. Its settings must hold every declared setting and no other
 * key, each value must decode, each origin must fit its declaration, and the hash must match the
 * values. Returns the input, the decoded values and the snapshot in its canonical encoding.
 *
 * @stability unstable
 * @category checking
 */
export const check = Effect.fnUntraced(function* (raw: unknown) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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

/**
 * Decodes a JSON string as a start's input and runs `check` on it.
 *
 * @stability unstable
 * @category decoding
 */
export const decode = Effect.fnUntraced(function* (encoded: unknown) {
  const input = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Start.Input))(encoded, {
    onExcessProperty: "error",
  });
  return yield* check(input);
}, Effect.provide(Digest.layerWebCrypto));

/**
 * Decodes a raw value as a start's receipt and checks that it is the receipt it claims to be.
 *
 * **Details**
 *
 * The receipt's settings must pass the same checks as an input's. Its entry must carry the start's
 * id and sit in that start's stream. When `expected` is given, the receipt must also match it: the
 * same start, settings, build and repo, and the same origin when `expected` names one. A receipt
 * that does not match fails with `StartsError` and the reason `Decode`.
 *
 * @stability unstable
 * @category checking
 */
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

/**
 * Reads the start's input from the Worker's `INSTANCE` binding, with `decode`. Any failure is a
 * `StartsError` with the reason `Decode`.
 *
 * @stability unstable
 * @category decoding
 */
export const read = Effect.gen(function* () {
  const env = yield* WorkerEnvironment;
  return yield* decode(env.INSTANCE).pipe(
    Effect.mapError((cause) => new StartsError({ reason: new Decode({ cause }) })),
  );
});
