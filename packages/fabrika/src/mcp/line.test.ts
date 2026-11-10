import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {programList} from "../shell/programs.ts";
import {SMALL} from "../shell/small.ts";
import {driveFor} from "./drive.ts";
// made up: `LINE`, `LINE_TOOL` and `LineRefused` follow stop.ts's `STOP`, `STOP_TOOL` and
// `StopRefused`; the plan names `LineAsk` and `LineAnswer` only.
import {LINE, LINE_TOOL, LineAnswer, LineAsk, LineRefused} from "./line.ts";
import {callOf} from "./tools.ts";

// The host's `line` tool, beside `runs`, `job` and `stop` (tracker 185b, PR 3): an agent runs one
// line in its own tile, as a person types one. Today's version. A line can do what a person's line
// can, and that cannot be proven less, so it is destructive; `pipeline` reaches GitHub, so it is
// open-world; two of one line are two jobs, so it is not idempotent. MCP's four hints say so (spec
// 2025-11-25, "Tools"); a client treats them as hints only.
//
// There is no `background` flag (the owner's call B): `&` in the line is the one way to say it, so
// a flag and an `&` can never disagree.
//
//   line {line: "pipeline --ticket 117 &"}   {_tag: "job", job: {n: 12, text: "pipeline --ticket 117 &", tile: "t2", ...}}
//   line {line: "jobs"}                      {_tag: "said", lines: ["[12] running   pipeline --ticket 117"], status: 0}
//   line {line: "a\nb"}                      refused by the schema: the refusal names `line`
//   line {line: "tally", background: true}   refused by the schema: there is no `background`

const LIST = programList(SMALL);

describe("the line tool's schema", () => {
	it("is a host tool named line, with no _, so it never equals a <program>_<input> name", () => {
		expect(LINE).toBe("line");
		expect(LINE_TOOL.name).toBe(LINE);
		expect(LINE).not.toContain("_");
		// The one way to run a line in the background, said where the agent reads it.
		expect(LINE_TOOL.description).toContain("&");
	});

	it("carries the spec's four hints: it writes, it is destructive, twice is two jobs, and it reaches outside", () => {
		expect(LINE_TOOL.annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true,
		});
	});

	it("takes only the line, 1 to 4096 characters, and no background flag", () => {
		expect(LINE_TOOL.inputSchema).toMatchObject({
			type: "object",
			properties: {line: {type: "string", minLength: 1, maxLength: 4096}},
			additionalProperties: false,
		});
		expect(Object.keys(LINE_TOOL.inputSchema.properties ?? {})).toEqual(["line"]);
		expect([...(LINE_TOOL.inputSchema.required ?? [])]).toEqual(["line"]);
		const fits = Schema.is(LineAsk);
		expect(fits({line: "tally &"})).toBe(true);
		expect(fits({line: "x".repeat(4096)})).toBe(true);
		expect(fits({line: "x".repeat(4097)})).toBe(false);
		expect(fits({line: ""})).toBe(false);
		expect(fits({})).toBe(false);
	});

	it("answers one of two cases, each tagged by Effect: job, said", () => {
		expect(Object.keys(LineAnswer.cases).sort()).toEqual(["job", "said"]);
		const decode = Schema.decodeUnknownSync(LineAnswer);
		const job = {
			n: 12,
			text: "pipeline --ticket 117 &",
			tile: "t2",
			state: {_tag: "running"},
			lines: [],
		};
		expect(decode({_tag: "job", job})).toEqual({_tag: "job", job});
		expect(decode({_tag: "said", lines: ["[12] running   tally"], status: 0})).toEqual({
			_tag: "said",
			lines: ["[12] running   tally"],
			status: 0,
		});
		expect(() => decode({_tag: "said", lines: []})).toThrow();
		expect(() => decode({_tag: "job", n: 12})).toThrow();
	});
});

describe("a line call, read", () => {
	it("is read as a line with what it asks", () => {
		// made up: the Call case `{kind: "line", ask}`, as `stop` is `{kind: "stop", ask}` today.
		expect(callOf(LIST, LINE, {line: "seq --to 3 | tally &"})).toEqual({
			kind: "line",
			ask: {line: "seq --to 3 | tally &"},
		});
	});

	it("is refused when it gives no line, an empty one, one too long, or a background flag, and the refusal names what", () => {
		for (const [args, names] of [
			[{}, /\bline\b/],
			[{line: ""}, /\bline\b/],
			[{line: "x".repeat(4097)}, /\bline\b/],
			[{line: 3}, /\bline\b/],
			[{line: "tally", background: true}, /\bbackground\b/],
		] as const) {
			const call = callOf(LIST, LINE, args);
			expect(call.kind, JSON.stringify(args)).toBe("refused");
			expect(call.kind === "refused" ? call.why : "").toMatch(names);
		}
	});

	it("is refused when it holds a newline or another control character: the person's tile shows it as typed", () => {
		// The tile writes `$ <line>` before it runs, so the person sees what ran. A line that moves the
		// cursor, clears a row or starts a row of its own could show the person something else: one
		// line, as the stop tool's `why` is (../shell/one-line.ts).
		for (const line of [
			"tally\nstop %1",
			"tally\rseq --to 3",
			"seq --to 3\u001b[2K\u001b[1Gjobs",
			"tally\u0000",
			"tally\u007f",
			"tally jobs",
		]) {
			const call = callOf(LIST, LINE, {line});
			expect(call.kind, JSON.stringify(line)).toBe("refused");
			expect(call.kind === "refused" ? call.why : "").toMatch(/\bline\b/);
		}

		// A line's own quotes, pipes and words in any script still fit.
		expect(
			callOf(LIST, LINE, {line: `tracker file='{"title":"Giriş bozuk","body":""}' &`}).kind,
		).toBe("line");
	});
});

describe("the door's line, as the host hands it", () => {
	const job = LineAnswer.cases.job.make({
		job: {n: 1, text: "tally &", tile: "t2", state: {_tag: "running"}, lines: []},
	});

	it("lists line after runs when the host hands it, and hands the host what the call asked", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const asked: unknown[] = [];
				const {drive, tools} = yield* driveFor({
					list: LIST,
					tiles: () => [],
					job: () => null,
					line: (ask) =>
						Effect.sync(() => {
							asked.push(ask);
							return job;
						}),
				});
				const called = yield* drive.call(LINE, {line: "tally &"});
				return {names: tools.map((t) => t.name), called, asked};
			}).pipe(Effect.scoped),
		);
		expect(seen.names).toContain(LINE);
		expect(seen.names.indexOf(LINE)).toBeGreaterThan(seen.names.indexOf("runs"));
		expect(seen.asked).toEqual([{line: "tally &"}]);
		expect(seen.called).toEqual({kind: "done", data: job});
	});

	it("says the host's refusal as the call's, and lists no line when the host hands none", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const handed = yield* driveFor({
					list: LIST,
					tiles: () => [],
					line: () =>
						Effect.fail(
							new LineRefused({
								why: "claude's tile runs %12 in the foreground: stop it, or end the line with &",
							}),
						),
				});
				const refused = yield* handed.drive.call(LINE, {line: "tally"});
				const none = yield* driveFor({list: LIST, tiles: () => []});
				const missing = yield* none.drive.call(LINE, {line: "tally"});
				return {refused, names: none.tools.map((t) => t.name), missing};
			}).pipe(Effect.scoped),
		);
		expect(seen.refused).toEqual({
			kind: "refused",
			why: "claude's tile runs %12 in the foreground: stop it, or end the line with &",
		});
		expect(seen.names).not.toContain(LINE);
		expect(seen.missing).toMatchObject({kind: "refused", why: expect.stringMatching(/line/)});
	});

	it("is never on the read-only door, and a line call there is refused before the host is asked", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				let asked = 0;
				const {drive, tools} = yield* driveFor({
					list: LIST,
					tiles: () => [],
					line: () =>
						Effect.sync(() => {
							asked += 1;
							return job;
						}),
					readOnly: {why: "the key ...: not a key"},
				});
				const called = yield* drive.call(LINE, {line: "tally &"});
				return {names: tools.map((t) => t.name), called, asked};
			}).pipe(Effect.scoped),
		);
		expect(seen.names).not.toContain(LINE);
		expect(seen.called).toEqual({kind: "refused", why: "there is no tool line"});
		expect(seen.asked).toBe(0);
	});
});
