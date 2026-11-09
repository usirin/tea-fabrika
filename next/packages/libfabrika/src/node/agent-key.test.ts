import {createHash} from "node:crypto";
// P25 F, next/. Every file here is a made-up test file in a private temporary home.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {NodeFileSystem} from "@effect/platform-node";
import {afterAll, expect, it} from "@effect/vitest";
import {Cause, Effect, Exit, Logger, Redacted, Result, Schema, Tracer} from "effect";
import * as fc from "fast-check";
import * as Id from "../id.ts";
import {Small, options} from "../mcp/mcp.test-support.ts";
import {raceChildren} from "./agent.test-support.ts";

const homes: string[] = [];
const home = () => {
	const h = mkdtempSync("/tmp/fh.");
	homes.push(h);
	return h;
};
afterAll(() => {
	for (const h of homes) rmSync(h, {recursive: true, force: true});
});
const validName = (s: string) =>
	s.length > 0 && /^[a-z0-9._-]+$/.test(s) && s !== "." && s !== "..";
const nameLaw = (accepts: (s: string) => boolean, name: string) =>
	expect(accepts(name), JSON.stringify(name)).toBe(validName(name));
it.effect.prop(
	"L06 AgentName accepts exactly safe lowercase components without normalization",
	{
		name: Schema.String,
		letters: Schema.Array(Schema.Literals(["a", "z", "0", "9", ".", "_", "-"])).check(
			Schema.isMaxLength(128),
		),
	},
	({name, letters}) =>
		Effect.gen(function* () {
			const {AgentName} = yield* Effect.promise(() => import("./agent-options.ts"));
			const decode = Schema.decodeUnknownResult(AgentName);
			for (const value of [
				name,
				letters.join(""),
				"valid-agent",
				".",
				"..",
				`../${name}`,
				`${name}/x`,
				`${name}\\x`,
				`${name}\u0000`,
				"Person",
				"@person",
			])
				nameLaw((s) => Result.isSuccess(decode(s)), value);
			const accepted = decode("a._-09");
			expect(accepted).toEqual(Result.succeed("a._-09"));
		}),
	options,
);
it("L05 arbitrary argv returns typed failure instead of a decoder defect", async () => {
	const {readMcpOptions} = await import("./agent-options.ts");
	const old = process.env.FABRIKA_HOME;
	process.env.FABRIKA_HOME = home();
	try {
		await fc.assert(
			fc.asyncProperty(fc.array(fc.string(), {maxLength: 30}), async (argv) => {
				const exit = await Effect.runPromise(
					Effect.exit(readMcpOptions(argv).pipe(Effect.provide(NodeFileSystem.layer))),
				);
				expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false);
			}),
			{seed: 119120, numRuns: 100},
		);
		const good = await Effect.runPromise(
			readMcpOptions(["--as", "valid-agent", "--url", "ws://127.0.0.1:9999/door"]).pipe(
				Effect.provide(NodeFileSystem.layer),
			),
		);
		expect(good).toMatchObject({name: "valid-agent", url: "ws://127.0.0.1:9999/door"});
	} finally {
		if (old === undefined) delete process.env.FABRIKA_HOME;
		else process.env.FABRIKA_HOME = old;
	}
});
it("L05 disk byte arrays fail visibly and preserve an existing malformed key", async () => {
	const {agentKey} = await import("./agent-key.ts");
	const {AgentName} = await import("./agent-options.ts");
	await fc.assert(
		fc.asyncProperty(fc.uint8Array({maxLength: 256}), async (raw) => {
			const h = home();
			mkdirSync(join(h, "agents"), {mode: 0o700});
			const file = join(h, "agents", "bad.key");
			// Deliberately impossible key prefix; byte variation must never become a fresh identity.
			const bytes = Buffer.concat([Buffer.from("malformed-key:"), raw]);
			writeFileSync(file, bytes, {mode: 0o600});
			const exit = await Effect.runPromise(
				Effect.exit(
					agentKey({home: h, name: Schema.decodeUnknownSync(AgentName)("bad")}).pipe(
						Effect.provide(NodeFileSystem.layer),
						Effect.provide(Id.Generator.layer),
					),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false);
			expect(readFileSync(file)).toEqual(bytes);
		}),
		{seed: 119120, numRuns: 100},
	);
});
const Identity = Schema.Struct({
	key: Schema.NonEmptyString,
	fingerprint: Schema.NonEmptyString,
	tab: Id.Tab,
});
const keyLaw = (a: unknown, b: unknown) => {
	const identities = [a, b].map((raw) => Schema.decodeUnknownSync(Identity)(raw));
	for (const identity of identities) {
		const raw = Buffer.from(identity.key, "base64url");
		expect(raw.length).toBe(32);
		expect(identity.fingerprint).toBe(
			`SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`,
		);
	}
	expect(identities[1]).toMatchObject({
		key: identities[0]!.key,
		fingerprint: identities[0]!.fingerprint,
	});
};
it.effect("scenario: L10 concurrent processes install one complete key", () =>
	// A real filesystem install needs outside processes, not an in-memory property.
	Effect.gen(function* () {
		const h = home();
		const {agentKey, readAgentKeyFile} = yield* Effect.promise(() => import("./agent-key.ts"));
		const {AgentName} = yield* Effect.promise(() => import("./agent-options.ts"));
		const [a, b] = yield* raceChildren(h, "key");
		keyLaw(a, b);
		const reopened = yield* agentKey({
			home: h,
			name: yield* Schema.decodeUnknownEffect(AgentName)("race"),
		});
		keyLaw(a, reopened.identity);
		expect(statSync(join(h, "agents", "race.key")).mode & 0o777).toBe(0o600);
		expect(statSync(join(h, "agents")).mode & 0o077).toBe(0);
		expect(Redacted.isRedacted(yield* readAgentKeyFile(join(h, "agents", "race.key")))).toBe(true);
	}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Id.Generator.layer)),
);
const secretLaw = (outputs: unknown, encodings: ReadonlyArray<string>) => {
	const json = JSON.stringify(outputs);
	for (const encoded of encodings)
		expect(
			json.includes(encoded) || json.includes(JSON.stringify(encoded).slice(1, -1)),
			"private bytes leaked",
		).toBe(false);
};
it.effect.prop(
	"L24 private bytes are Redacted on valid and malformed file reads and errors",
	{
		seed: Schema.Array(Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 255}))).check(
			Schema.isMinLength(32),
			Schema.isMaxLength(32),
		),
		n: Small,
	},
	({seed, n}) =>
		Effect.gen(function* () {
			const {readAgentKeyFile, agentKey} = yield* Effect.promise(() => import("./agent-key.ts"));
			const {AgentName} = yield* Effect.promise(() => import("./agent-options.ts"));
			const h = home();
			mkdirSync(join(h, "agents"), {mode: 0o700});
			// Test-owned Ed25519 seeds and PKCS8 encodings. No real key is read.
			const bytes = Buffer.from(seed),
				file = join(h, "agents", `case-${n}.key`);
			writeFileSync(file, bytes, {mode: 0o600});
			const logs: unknown[] = [],
				spans: unknown[] = [];
			const logger = Logger.layer([
				Logger.make((entry) => {
					logs.push(entry.message);
				}),
			]);
			const tracer = Tracer.make({
				span: (options) => {
					const span = new Tracer.NativeSpan(options);
					const end = span.end.bind(span);
					span.end = (...args) => {
						end(...args);
						spans.push({name: span.name, attributes: [...span.attributes], events: span.events});
					};
					return span;
				},
			});
			yield* Effect.gen(function* () {
				const redacted = yield* readAgentKeyFile(file);
				expect(Redacted.isRedacted(redacted)).toBe(true);
				const failure = yield* Effect.exit(
					agentKey({home: h, name: yield* Schema.decodeUnknownEffect(AgentName)(`case-${n}`)}),
				);
				secretLaw(
					{
						redacted,
						failure,
						errorText: Exit.isFailure(failure) ? Cause.pretty(failure.cause) : "",
					},
					[bytes.toString("hex"), bytes.toString("base64")],
				);
				// Positive neighbor: a key created by the module signs without exposing private fields.
				const good = yield* agentKey({
					home: h,
					name: yield* Schema.decodeUnknownEffect(AgentName)("good"),
				});
				const signed = yield* good.sign({
					nonce: "test",
					url: "ws://test/door",
					tab: Id.Tab.make("tab_0000000000e008000000000000"),
				});
				expect(typeof signed).toBe("string");
				// This file was created by the test operation above. Only the test unwraps it.
				const own = Buffer.from(
					Redacted.value(yield* readAgentKeyFile(join(h, "agents", "good.key"))),
				);
				secretLaw(
					{identity: good.identity, signed, logs, spans, failure},
					[
						bytes.toString("hex"),
						bytes.toString("base64"),
						own.toString("hex"),
						own.toString("base64"),
						own.toString("utf8"),
					].filter((s) => s.length >= 16),
				);
			}).pipe(Effect.withTracer(tracer), Effect.provide(logger));
		}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Id.Generator.layer)),
	options,
);
it("plant L06: traversal accepted or uppercase repaired", () => {
	expect(() => nameLaw(() => true, "../a")).toThrow();
	expect(() => nameLaw((s) => validName(s.toLowerCase()), "Person")).toThrow();
});
it("plant L05: synchronous key parser defects", () =>
	expect(() =>
		expect(() => Schema.decodeUnknownSync(Schema.String)(new Uint8Array())).not.toThrow(),
	).toThrow());
it("plant L10: overwritten winner or partial key", () => {
	const identity = (fill: number) => {
		const key = Buffer.alloc(32, fill);
		return {
			key: key.toString("base64url"),
			fingerprint: `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`,
			tab: Id.Tab.make("tab_0000000000e008000000000000"),
		};
	};
	keyLaw(identity(0), identity(0));
	expect(() => keyLaw(identity(0), identity(1))).toThrow();
	expect(() => keyLaw(identity(0), null)).toThrow();
});
it("plant L24: parser cause serializes private bytes", () =>
	expect(() => secretLaw({cause: "private-seed-base64"}, ["private-seed-base64"])).toThrow());
