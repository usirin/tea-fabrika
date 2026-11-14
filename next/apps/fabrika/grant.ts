import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { grantText } from "@kampus/libfabrika/access/Text";
import { Console, DateTime, Effect, Schema, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { SecureRandom } from "effect/crypto";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess } from "effect/process";

class GrantError extends Schema.TaggedError<GrantError>()("GrantError", { reason: Schema.String }) {}

const Target = Schema.NullOr(
  Schema.Struct({
    key: Schema.String,
    for: Schema.String,
    to: Schema.String,
    code: Schema.String,
    label: Schema.String,
  }),
);

const grant = Command.make(
  "grant",
  {
    kind: Argument.String("kind").pipe(Argument.withDefault(undefined)),
    url: Argument.String("url").pipe(Argument.withDefault(undefined)),
    fingerprint: Argument.String("fingerprint").pipe(Argument.withDefault(undefined)),
    code: Flag.String("code").pipe(Flag.withDefault(undefined)),
    label: Flag.String("label").pipe(Flag.withDefault(undefined)),
    key: Flag.String("key").pipe(Flag.withDefault(undefined)),
  },
  Effect.fn("grant.client")(function* (values) {
    const { kind, url, fingerprint } = values;

    if (
      kind !== "client" ||
      url === undefined ||
      fingerprint === undefined ||
      values.code === undefined ||
      values.key === undefined
    ) {
      return yield* new GrantError({
        reason: "usage: grant.ts client URL KEY --code=CODE --key=PATH",
      });
    }

    const { code, key } = values;
    const origin = yield* Effect.try({
      try: () => new URL(url).origin,
      catch: () => new GrantError({ reason: "bad_url" }),
    });
    const unreachable = () => new GrantError({ reason: "unreachable" });
    const targetUrl = yield* Effect.try({
      try: () => `${origin}/grant/client/${encodeURIComponent(fingerprint)}?code=${encodeURIComponent(code)}`,
      catch: unreachable,
    });
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(targetUrl).pipe(Effect.mapError(unreachable));
    // The body is read as text: the client's own JSON reader takes an empty body for `null`.
    const target = yield* response.text.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Target))),
      Effect.mapError(() => new GrantError({ reason: "bad_target" })),
    );

    if (target === null) {
      return yield* new GrantError({ reason: "not_waiting" });
    }

    const text = grantText({
      id: yield* SecureRandom.SecureRandom.use((random) => random.uuidV4()),
      key: target.key,
      for: target.for,
      to: target.to,
      as: "window",
      saw: {
        code: target.code,
        label: values.label ?? target.label,
        location: "local",
        method: "command",
        check: "none",
        has: [],
      },
      sentAt: DateTime.formatIso(yield* DateTime.now),
    });
    const armored = yield* Effect.scoped(
      Effect.gen(function* () {
        const signer = yield* ChildProcess.make("ssh-keygen", ["-Y", "sign", "-n", "fabrika-client", "-f", key], {
          stdin: Stream.make(new TextEncoder().encode(text)),
        });
        const [out, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(signer.stdout)), signer.exitCode], {
          concurrency: 2,
        });

        if (Number(code) !== 0) {
          return yield* new GrantError({ reason: "sign_failed" });
        }

        return out;
      }),
    );
    const result = yield* HttpClientRequest.post(`${origin}/grant`).pipe(
      HttpClientRequest.bodyText(JSON.stringify({ text, armored }), "application/json"),
      client.execute,
      Effect.mapError(unreachable),
    );

    if (result.status < 200 || result.status > 299) {
      return yield* new GrantError({ reason: "refused" });
    }

    const reply = yield* result.text.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)))),
      Effect.mapError(() => new GrantError({ reason: "bad_reply" })),
    );

    if (reply._tag !== "applied") {
      return yield* new GrantError({ reason: "refused" });
    }

    yield* Console.log(`Granted ${fingerprint} to ${target.for}`);
  }),
);

NodeRuntime.runMain(
  Command.runWith(grant, { version: "0.0.0", renderErrors: false })(process.argv.slice(2)).pipe(
    Effect.catchTag("ShowHelp", () => Effect.fail(new GrantError({ reason: "bad_args" }))),
    Effect.provide([NodeServices.layer, SecureRandom.layerWebCrypto, FetchHttpClient.layer]),
    // The request keeps the headers it had: no trace headers ride along to an outside address.
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  ),
);
