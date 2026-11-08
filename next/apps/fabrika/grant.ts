import {randomUUID} from "node:crypto";
import {parseArgs} from "node:util";
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {grantText} from "@kampus/libfabrika/coordination";
import {Console, Effect, Schema, Stream} from "effect";
import {ChildProcess} from "effect/process";

class GrantError extends Schema.TaggedError<GrantError>()("GrantError", {why: Schema.String}) {}
const Target = Schema.NullOr(
	Schema.Struct({
		key: Schema.String,
		for: Schema.String,
		to: Schema.String,
		code: Schema.String,
		label: Schema.String,
	}),
);
const grant = Effect.fn("grant.client")(function* () {
	const {positionals, values} = parseArgs({
		allowPositionals: true,
		options: {code: {type: "string"}, label: {type: "string"}, key: {type: "string"}},
	});
	const [kind, url, fingerprint] = positionals;
	if (
		kind !== "client" ||
		url === undefined ||
		fingerprint === undefined ||
		values.code === undefined ||
		values.key === undefined
	)
		return yield* new GrantError({why: "usage: grant.ts client URL KEY --code=CODE --key=PATH"});
	const {code, key} = values;
	const origin = new URL(url).origin;
	// oxlint-disable-next-line fabrika/no-promises -- edge: the grant command reads a public target over HTTP
	const response = yield* Effect.tryPromise({
		try: () =>
			fetch(
				`${origin}/grant/client/${encodeURIComponent(fingerprint)}?code=${encodeURIComponent(code)}`,
			),
		catch: () => new GrantError({why: "unreachable"}),
	});
	// oxlint-disable-next-line fabrika/no-promises -- edge: HTTP response bodies return a Promise
	const raw = yield* Effect.tryPromise({
		try: () => response.json(),
		catch: () => new GrantError({why: "bad_target"}),
	});
	const target = yield* Schema.decodeUnknownEffect(Target)(raw).pipe(
		Effect.mapError(() => new GrantError({why: "bad_target"})),
	);
	if (target === null) return yield* new GrantError({why: "not_waiting"});
	const text = grantText({
		id: randomUUID(),
		key: target.key,
		for: target.for,
		to: target.to,
		as: "window",
		saw: {
			code: target.code,
			label: values.label ?? target.label,
			where: "local",
			how: "command",
			check: "none",
			has: [],
		},
		sentAt: new Date().toISOString(),
	});
	const armored = yield* Effect.scoped(
		Effect.gen(function* () {
			const signer = yield* ChildProcess.make(
				"ssh-keygen",
				["-Y", "sign", "-n", "fabrika-client", "-f", key],
				{stdin: Stream.make(new TextEncoder().encode(text))},
			);
			const [out, code] = yield* Effect.all(
				[Stream.mkString(Stream.decodeText(signer.stdout)), signer.exitCode],
				{concurrency: 2},
			);
			if (Number(code) !== 0) return yield* new GrantError({why: "sign_failed"});
			return out;
		}),
	);
	// oxlint-disable-next-line fabrika/no-promises -- edge: the signed grant is posted over HTTP
	const result = yield* Effect.tryPromise({
		try: () =>
			fetch(`${origin}/grant`, {
				method: "POST",
				headers: {"content-type": "application/json"},
				body: JSON.stringify({text, armored}),
			}),
		catch: () => new GrantError({why: "unreachable"}),
	});
	if (!result.ok) return yield* new GrantError({why: "refused"});
	// oxlint-disable-next-line fabrika/no-promises -- edge: HTTP response bodies return a Promise
	const applied = yield* Effect.tryPromise({
		try: () => result.json(),
		catch: () => new GrantError({why: "bad_reply"}),
	});
	const reply = yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(
		applied,
	).pipe(Effect.mapError(() => new GrantError({why: "bad_reply"})));
	if (reply._tag !== "applied") return yield* new GrantError({why: "refused"});
	yield* Console.log(`Granted ${fingerprint} to ${target.for}`);
});
NodeRuntime.runMain(grant().pipe(Effect.provide(NodeServices.layer)));
