import {Duration, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {programList} from "../shell/programs.ts";
import {SMALL} from "../shell/small.ts";
// made up: `STOP` and `STOP_TOOL` follow job.ts's `JOB` and `JOB_TOOL`; the plan names neither.
import {EXIT_WITHIN, STOP, STOP_TOOL, StopAnswer, StopAsk, Why} from "./stop.ts";
import {callOf} from "./tools.ts";

// The host's `stop` tool, beside `runs` and `job` (tracker 185b, PR 1): an agent stops job n of the
// host's table, and must say why. Today's version. It writes, so it is never on the read-only door;
// stopping a job twice is the same as once, so it is idempotent; it reaches nothing outside the
// host. MCP's four hints say so (spec 2025-11-25, "Tools"); a client treats them as hints only.
//
//   stop {n: 3, why: "wrong ticket"}   {_tag: "stopped", job: {n: 3, ..., state: {_tag: "ended", how: "stopped"}}}
//   stop {n: 3, why: "wrong ticket"}   {_tag: "dropped", n: 3, text: "counter"}     it was detached
//   stop {n: 3, why: "wrong ticket"}   {_tag: "asked", n: 3}                        not ended within 10 s
//   stop {n: 3}                        refused: the why is required, and the refusal names `why`

const LIST = programList(SMALL);

describe("the stop tool's schema", () => {
	it("is a host tool named stop, with no _, so it never equals a <program>_<input> name", () => {
		expect(STOP).toBe("stop");
		expect(STOP_TOOL.name).toBe(STOP);
		expect(STOP).not.toContain("_");
		expect(STOP_TOOL.description.trim()).not.toBe("");
	});

	it("carries the spec's four hints: it writes, it is destructive, twice is once, and it stays in the host", () => {
		expect(STOP_TOOL.annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
			openWorldHint: false,
		});
	});

	it("takes a job's number and a why of 1 to 500 characters, both required", () => {
		expect(STOP_TOOL.inputSchema).toMatchObject({
			type: "object",
			properties: {n: {type: "integer"}, why: {type: "string", minLength: 1, maxLength: 500}},
		});
		expect([...(STOP_TOOL.inputSchema.required ?? [])].sort()).toEqual(["n", "why"]);
	});

	it("holds why to 1 to 500 characters", () => {
		const fits = Schema.is(Why);
		expect(fits("")).toBe(false);
		expect(fits("a")).toBe(true);
		expect(fits("x".repeat(500))).toBe(true);
		expect(fits("x".repeat(501))).toBe(false);
		const asks = Schema.is(StopAsk);
		expect(asks({n: 3, why: "wrong ticket"})).toBe(true);
		expect(asks({n: 3})).toBe(false);
		expect(asks({n: 3.5, why: "wrong ticket"})).toBe(false);
	});

	it("answers one of three cases, each tagged by Effect: stopped, dropped, asked", () => {
		expect(Object.keys(StopAnswer.cases).sort()).toEqual(["asked", "dropped", "stopped"]);
		const decode = Schema.decodeUnknownSync(StopAnswer);
		const job = {
			n: 3,
			text: "counter &",
			tile: "t1",
			state: {_tag: "ended", how: "stopped"},
			lines: ["1", "2"],
		};
		expect(decode({_tag: "stopped", job})).toEqual({_tag: "stopped", job});
		expect(decode({_tag: "dropped", n: 3, text: "counter &"})).toEqual({
			_tag: "dropped",
			n: 3,
			text: "counter &",
		});
		expect(decode({_tag: "asked", n: 3})).toEqual({_tag: "asked", n: 3});
		expect(() => decode({_tag: "stopped", n: 3})).toThrow();
	});

	it("waits 10 seconds for a job to end before it answers asked: the wait the window's restart gives a host", () => {
		expect(Duration.toMillis(EXIT_WITHIN)).toBe(10_000);
	});
});

describe("a stop call, read", () => {
	it("is read as a stop with what it asks", () => {
		// made up: the Call case `{kind: "stop", ask}`, as `job` is `{kind: "job", ask}` today.
		expect(callOf(LIST, STOP, {n: 3, why: "wrong ticket"})).toEqual({
			kind: "stop",
			ask: {n: 3, why: "wrong ticket"},
		});
	});

	it("is refused when it gives no why, an empty one or one too long, and the refusal names why", () => {
		for (const args of [{n: 3}, {n: 3, why: ""}, {n: 3, why: "x".repeat(501)}]) {
			const call = callOf(LIST, STOP, args);
			expect(call.kind).toBe("refused");
			expect(call.kind === "refused" ? call.why : "").toMatch(/\bwhy\b/);
		}
	});

	it("is refused when it names no job, and the refusal names n", () => {
		for (const args of [{why: "wrong ticket"}, {n: "3", why: "wrong ticket"}, {n: 1.5, why: "x"}]) {
			const call = callOf(LIST, STOP, args);
			expect(call.kind).toBe("refused");
			expect(call.kind === "refused" ? call.why : "").toMatch(/\bn\b/);
		}
	});
});
