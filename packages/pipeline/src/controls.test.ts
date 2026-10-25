import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {controls, createControls, mustFail, mustPass, Result} from "./controls.ts";

// Controls on their own: the pure answer, then the child stepped by hand the
// way a parent steps it.

describe("the answer", () => {
	it("is ok only when red on the bad input and green on the good", () => {
		expect(controls("red", "green")).toEqual({kind: "ok"});
		expect(controls("green", "green")).toEqual({kind: "missed"});
		expect(controls("red", "red")).toEqual({kind: "false_alarm"});
		expect(controls("green", "red")).toEqual({kind: "backwards"});
	});

	it("takes one side alone, as the test writer has on the base", () => {
		// A new Property: its test must be red on the base. Green is `already_passes`.
		expect(mustFail("red")).toEqual({kind: "ok"});
		expect(mustFail("green")).toEqual({kind: "missed"});
		// An existing Property: its test must be green on the base. Red is `fails_on_base`.
		expect(mustPass("green")).toEqual({kind: "ok"});
		expect(mustPass("red")).toEqual({kind: "false_alarm"});
	});

	it("both together agree with each side alone: ok only when both are ok", () => {
		const result = fc.constantFrom(...Result.literals);
		fc.assert(
			fc.property(result, result, (bad, good) => {
				const both = controls(bad, good).kind;
				const alone = [mustFail(bad).kind, mustPass(good).kind];
				expect(both === "ok").toBe(alone.every((k) => k === "ok"));
				expect(both === "missed" || both === "backwards").toBe(alone.includes("missed"));
				expect(both === "false_alarm" || both === "backwards").toBe(alone.includes("false_alarm"));
			}),
		);
	});
});

describe("the child: one check run per side, the answer once all are back", () => {
	const tests = createControls({
		name: "tests",
		input: Schema.Struct({commit: Schema.String}),
		verdict: Schema.Struct({failed: Schema.Array(Schema.String)}),
		resultOf: (v) => (v.failed.length === 0 ? "green" : "red"),
	});
	const red = {failed: ["p1"]};
	const green = {failed: []};

	it("asks for both runs, each carrying its key and side, and answers when both are back", () => {
		const [running, cmds] = tests.start("p1", {bad: {commit: "base"}, good: {commit: "head"}});
		expect(cmds).toEqual([
			{type: "tests_control", key: "p1", side: "bad", on: {commit: "base"}},
			{type: "tests_control", key: "p1", side: "good", on: {commit: "head"}},
		]);
		const half = tests.ran(running, "good", green);
		expect(half.phase).toBe("running");
		expect(tests.asked(half)).toEqual([cmds[0]]);
		expect(tests.ran(half, "bad", red)).toEqual({phase: "done", key: "p1", answer: {kind: "ok"}});
		expect(tests.ran(half, "bad", green)).toEqual({
			phase: "done",
			key: "p1",
			answer: {kind: "missed"},
		});
	});

	it("answers from one side when given one", () => {
		const [onlyBad, cmds] = tests.start("new", {bad: {commit: "base"}, good: null});
		expect(cmds).toHaveLength(1);
		expect(tests.ran(onlyBad, "bad", green)).toMatchObject({answer: {kind: "missed"}});

		const [onlyGood] = tests.start("old", {bad: null, good: {commit: "base"}});
		expect(tests.ran(onlyGood, "good", red)).toMatchObject({answer: {kind: "false_alarm"}});
	});

	it("leaves a side it never asked, or a second answer, alone", () => {
		const [onlyBad] = tests.start("new", {bad: {commit: "base"}, good: null});
		expect(tests.ran(onlyBad, "good", red)).toBe(onlyBad);
		const [both] = tests.start("p1", {bad: {commit: "base"}, good: {commit: "head"}});
		const half = tests.ran(both, "bad", red);
		expect(tests.ran(half, "bad", green)).toBe(half);
	});

	it("says nothing about the check when one run could not run", () => {
		const [both] = tests.start("p1", {bad: {commit: "base"}, good: {commit: "head"}});
		const stopped = tests.failed(both, "good");
		expect(stopped).toEqual({phase: "could_not_run", key: "p1", side: "good"});
		expect(tests.asked(stopped)).toEqual([]);
		expect(tests.ran(stopped, "bad", red)).toBe(stopped);
	});

	it("has no control with neither side", () => {
		// @ts-expect-error a control needs at least one side
		tests.start("none", {bad: null, good: null});
	});
});
