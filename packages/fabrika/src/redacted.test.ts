// A secret held as an Effect `Redacted` shows `<redacted>` on every way out our code has: a log
// line, `JSON.stringify`, `String()`, Node's inspect (what `console.log` prints), an Effect error
// and its cause, a span attribute, and a schema's encoding. Never its text.
// docs/direction/secrets-are-redacted.md.
import {inspect} from "node:util";
import {
	Cause,
	Config,
	ConfigProvider,
	Effect,
	Exit,
	Layer,
	Logger,
	Option,
	Redacted,
	Schema,
} from "effect";
import {describe, expect, it} from "vitest";
import {Session} from "./host/http.ts";
import {memoryTracing} from "./shell/trace/otel.ts";

const TEXT = "fabrika_p_made-up-secret-for-this-test";
const secret = Redacted.make(TEXT);

class Refused extends Schema.TaggedError<Refused>()("Refused", {
	token: Schema.Redacted(Schema.String),
	why: Schema.String,
}) {}

describe("a secret held as a Redacted", () => {
	it("prints as <redacted> through String, a template, JSON and inspect", () => {
		expect(String(secret)).toBe("<redacted>");
		expect(`${secret}`).toBe("<redacted>");
		expect(JSON.stringify({token: secret})).toBe('{"token":"<redacted>"}');
		expect(inspect({token: secret}, {depth: 5})).not.toContain(TEXT);
		expect(inspect({token: secret}, {depth: 5})).toContain("<redacted>");
	});

	it("logs as <redacted> through each of Effect's formats, as the message and as an annotation", async () => {
		const lines: string[] = [];
		const keep = <A>(format: Logger.Logger<unknown, A>) =>
			Logger.map(format, (line) => {
				lines.push(typeof line === "string" ? line : JSON.stringify(line));
			});
		await Effect.runPromise(
			Effect.log("the token is", secret, {token: secret}).pipe(
				Effect.annotateLogs("token", secret),
				Effect.provide(
					Logger.layer([
						keep(Logger.formatSimple),
						keep(Logger.formatLogFmt),
						keep(Logger.formatJson),
						keep(Logger.formatStructured),
					]),
				),
			),
		);
		expect(lines).toHaveLength(4);
		for (const line of lines) expect(line).not.toContain(TEXT);
		expect(lines.join("\n")).toContain("<redacted>");
	});

	it("leaves an Effect error, its message and its cause as <redacted>", async () => {
		const exit = await Effect.runPromiseExit(Effect.fail(new Refused({token: secret, why: "no"})));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) return;
		const shown = [
			Cause.pretty(exit.cause),
			String(Cause.squash(exit.cause)),
			JSON.stringify(Cause.squash(exit.cause)),
			inspect(Cause.squash(exit.cause), {depth: 5}),
		];
		for (const s of shown) expect(s).not.toContain(TEXT);
		expect(shown.join("\n")).toContain("<redacted>");
	});

	it("goes out of a span as <redacted>, whatever the exporter is sent", async () => {
		const t = memoryTracing({raw: true});
		await Effect.runPromise(
			Effect.void.pipe(
				Effect.withSpan("login", {attributes: {token: secret}}),
				Effect.annotateSpans("again", secret),
				Effect.provide(Layer.fresh(t.layer)),
			),
		);
		const login = t.spans.find((s) => s.name === "login");
		expect(login).toBeDefined();
		const attributes = JSON.stringify(login?.attributes);
		expect(attributes).not.toContain(TEXT);
		expect(attributes).toContain("<redacted>");
	});

	it("is never written in plain text by the session's schema: encoding it is refused", () => {
		const session = Schema.decodeUnknownSync(Session)({
			token: TEXT,
			who: {kind: "user", id: "owner"},
			expires: 1,
		});
		expect(String(session.token)).toBe("<redacted>");
		expect(Redacted.value(session.token)).toBe(TEXT);
		expect(() => Schema.encodeSync(Session)(session)).toThrow();
	});

	it("is read from the env as none when it is empty or missing, so no code checks for an empty one", () => {
		const read = (env: Record<string, string>) =>
			Effect.runSync(
				Config.option(Config.Redacted("A_TOKEN")).pipe(
					Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({env}))),
				),
			);
		expect(Option.isNone(read({A_TOKEN: ""}))).toBe(true);
		expect(Option.isNone(read({}))).toBe(true);
		expect(Option.map(read({A_TOKEN: TEXT}), Redacted.value)).toEqual(Option.some(TEXT));
	});
});
