import {generateKeyPairSync, sign} from "node:crypto";
// P23, next/. These services supply outside replies. All link and menu decisions use product code.
import type {Redacted} from "effect";
import {Context, Deferred, Effect, Layer, Ref, Schema, Tracer} from "effect";
import {Digest, SecureRandom} from "effect/crypto";
import {IdGenerator} from "../data/id.ts";
import {KeyLine} from "../transport/sshsig.ts";
type BrowserModule = typeof import("./browser-link.ts");
type PassModule = typeof import("../transport/browser-pass.ts");

export const checks = {arbitrary: {seed: 119120, runs: 200, size: 64}};
export const Bytes32 = Schema.Array(
	Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 255})),
).check(Schema.isBetweenLength(32, 32));
export const SafeTime = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 2 ** 40}));
export const Operations = Schema.Array(
	Schema.Literals(["prepare", "open", "fail", "take", "knock", "interrupt", "discard"]),
).check(Schema.isMaxLength(64));

// P19/P21 tags, replaced by their real imports when those branches land.
export class DesktopDown extends Schema.TaggedError<DesktopDown>()("DesktopDown", {
	why: Schema.Literal("storage"),
}) {}
export class DesktopRecording extends Context.Service<
	DesktopRecording,
	{
		readonly put: (value: Schema.Json) => Effect.Effect<void, DesktopDown>;
		readonly flush: Effect.Effect<void, DesktopDown>;
	}
>()("@kampus/libfabrika/DesktopRecording") {}

export class PersonKey extends Context.Service<
	PersonKey,
	{
		readonly line: Effect.Effect<KeyLine>;
		readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array>;
	}
>()("@kampus/libfabrika/PersonKey") {}
export const personKeyLayer = Effect.fn("test.personKeyLayer")(function* () {
	const key = generateKeyPairSync("ed25519");
	const raw = key.publicKey.export({type: "spki", format: "der"}).subarray(-32);
	const type = Buffer.from("ssh-ed25519");
	const blob = Buffer.concat([
		Buffer.from([0, 0, 0, type.length]),
		type,
		Buffer.from([0, 0, 0, 32]),
		raw,
	]);
	const line = yield* Schema.decodeUnknownEffect(KeyLine)(`ssh-ed25519 ${blob.toString("base64")}`);
	return Layer.succeed(PersonKey, {
		line: Effect.succeed(line),
		sign: (bytes) => Effect.sync(() => new Uint8Array(sign(null, bytes, key.privateKey))),
	});
});

export const browserLinkFixture = Effect.fn("test.browserLinkFixture")(function* (
	options: {
		readonly bytes?: ReadonlyArray<number>;
		readonly origin?: string;
		readonly beforeOpen?: () => void;
		readonly pauseOpen?: boolean;
		readonly failRecording?: boolean;
	} = {},
) {
	const module = "./browser-link.ts";
	// oxlint-disable-next-line fabrika/no-promises -- edge: tests load the missing product module lazily
	const product: BrowserModule = yield* Effect.promise(() => import(module));
	const {BrowserLink, ExternalBrowser} = product;
	const passModule = "../transport/browser-pass.ts";
	// oxlint-disable-next-line fabrika/no-promises -- edge: tests load the missing product module lazily
	const pass: PassModule = yield* Effect.promise(() => import(passModule));
	const {BrowserLinkError} = pass;
	const opened = yield* Ref.make<Array<{origin: string; pass: Redacted.Redacted<string>}>>([]);
	const observations = yield* Ref.make<Schema.Json[]>([]);
	const failing = yield* Ref.make(false);
	const entered = yield* Deferred.make<void>();
	const release = yield* Deferred.make<void>();
	const sizes: number[] = [];
	const spans: Tracer.NativeSpan[] = [];
	const tracer = Tracer.make({
		span(options) {
			const span = new Tracer.NativeSpan(options);
			spans.push(span);
			return span;
		},
	});
	const external = Layer.succeed(ExternalBrowser, {
		open: Effect.fn("test.externalOpen")(function* (
			origin: string,
			pass: Redacted.Redacted<string>,
		) {
			yield* Effect.sync(() => options.beforeOpen?.());
			yield* Ref.update(opened, (list) => [...list, {origin, pass}]);
			yield* Deferred.succeed(entered, undefined);
			if (options.pauseOpen) yield* Deferred.await(release);
			if (yield* Ref.get(failing)) return yield* new BrowserLinkError({why: "open"});
		}),
	});
	const recording = Layer.succeed(DesktopRecording, {
		put: Effect.fn("test.recordBrowser")(function* (value: Schema.Json) {
			if (options.failRecording) return yield* new DesktopDown({why: "storage"});
			yield* Ref.update(observations, (list) => [...list, value]);
		}),
		flush: Effect.void,
	});
	const random = Layer.succeed(
		SecureRandom.SecureRandom,
		SecureRandom.make((size) => {
			sizes.push(size);
			return Uint8Array.from(options.bytes ?? Array.from({length: size}, (_, i) => i));
		}),
	);
	const layer = BrowserLink.layer(options.origin ?? "http://127.0.0.1:43123").pipe(
		Layer.provide(
			Layer.mergeAll(external, recording, random, IdGenerator.layer, Digest.layerWebCrypto),
		),
	);
	return {
		layer,
		opened: Ref.get(opened),
		observations: Ref.get(observations),
		failOpen: Ref.set(failing, true),
		entered: Deferred.await(entered),
		release: Deferred.succeed(release, undefined),
		sizes,
		spans,
		tracer,
	};
});

// Test oracle only. It never chooses whether a pass grants a key.
// Check raw, percent-encoded, nested percent-encoded, base64, base64url and JSON escape forms.
export const secretForms = (secret: string): ReadonlyArray<string> => {
	const percent = [...secret]
		.map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
		.join("");
	return [
		...new Set([
			secret,
			percent,
			percent.toUpperCase(),
			encodeURIComponent(percent),
			encodeURIComponent(encodeURIComponent(percent)),
			`%${secret.charCodeAt(0).toString(16)}${secret.slice(1)}`,
			Buffer.from(secret).toString("base64"),
			Buffer.from(secret).toString("base64url"),
			[...secret].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""),
		]),
	];
};
export const leaks = (secret: string, value: unknown, seen = new WeakSet<object>()): boolean => {
	if (typeof value === "string") {
		let text = value;
		const forms = secretForms(secret);
		for (;;) {
			if (forms.some((form) => text.includes(form))) return true;
			const decoded = text
				.replace(/%([a-f\d]{2})/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)))
				.replace(/\\u([a-f\d]{4})/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)));
			if (decoded === text) return false;
			text = decoded;
		}
	}
	if (value !== null && typeof value === "object") {
		if (seen.has(value)) return false;
		seen.add(value);
		if (value instanceof Error)
			return leaks(secret, [value.message, value.stack, value.cause, {...value}], seen);
		if (Array.isArray(value)) return value.some((part) => leaks(secret, part, seen));
		return Object.entries(value).some(
			([key, part]) => leaks(secret, key, seen) || leaks(secret, part, seen),
		);
	}
	return false;
};
