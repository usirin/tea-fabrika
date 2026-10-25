import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {type Changed, createPoll} from "./poll.ts";
import {act, gather, intentOf, listen} from "./primitives.ts";

// Poll on its own, with no engine: a parent steps it by hand, the way a
// watcher steps one child per open pull request.

const Checks = Schema.Struct({
	state: Schema.Literals(["pending", "green", "red"]),
	head: Schema.String,
});
type Checks = typeof Checks.Type;

const readChecks = gather("checks_read", {
	input: Schema.Struct({key: Schema.String, pr: Schema.Number}),
	ok: Checks,
	err: ["unknown"],
});
const writePr = act("pr_write", {
	input: Schema.Struct({pr: Schema.Number, state: Schema.String}),
	ok: Schema.Null,
	err: ["unknown"],
});

const ci = createPoll({
	name: "ci",
	read: (key, {pr}: {pr: number}) => readChecks({key, pr}),
	by: (checks: Checks) => checks.state,
});

/** The parent's part: a change becomes a `pr` fact, named by where it stands. */
const fact = (c: Changed<Checks>) =>
	writePr({pr: 74, state: c.value.state, intent: intentOf(c.key, "pr", c.tick)});

/** One tick and one read, the way a parent's update would step them. */
function round(s: ReturnType<typeof ci.start>, value: Checks) {
	const clock = ci.clock(s);
	if (clock === null) throw new Error("the clock is off between reads");
	const [reading, reads] = ci.ticked(s, clock.msg);
	expect(reads).toEqual([{type: "checks_read", key: "pr-74", pr: 74}]);
	return ci.answered(reading, value);
}

describe("poll: a fact only on change", () => {
	it("pending, pending, green: the first read and the change count, the repeat does not", () => {
		const s0 = ci.start("pr-74", {pr: 74}, 60_000);
		expect(ci.clock(s0)).toEqual({ms: 60_000, msg: {type: "ci_tick", key: "pr-74", tick: 0}});

		const [s1, first] = round(s0, {state: "pending", head: "a1"});
		const [s2, second] = round(s1, {state: "pending", head: "a1"});
		const [, third] = round(s2, {state: "green", head: "a1"});

		expect([first, second, third].map((c) => (c === null ? null : fact(c)))).toEqual([
			{type: "pr_write", pr: 74, state: "pending", intent: "pr-74/pr/0"},
			null,
			{type: "pr_write", pr: 74, state: "green", intent: "pr-74/pr/2"},
		]);
	});

	it("counts only what `by` names: a new head with the same state is no change", () => {
		const [s1] = round(ci.start("pr-74", {pr: 74}, 1000), {state: "pending", head: "a1"});
		expect(round(s1, {state: "pending", head: "b2"})[1]).toBeNull();
	});

	it("reads once per tick: a stale tick, another child's tick, or a tick mid-read changes nothing", () => {
		const s0 = ci.start("pr-74", {pr: 74}, 1000);
		const [reading] = ci.ticked(s0, {type: "ci_tick", key: "pr-74", tick: 0});

		expect(ci.ticked(s0, {type: "ci_tick", key: "pr-74", tick: 5})).toEqual([s0, []]);
		expect(ci.ticked(s0, {type: "ci_tick", key: "pr-75", tick: 0})).toEqual([s0, []]);
		expect(ci.ticked(reading, {type: "ci_tick", key: "pr-74", tick: 0})).toEqual([reading, []]);
		expect(ci.clock(reading)).toBeNull();
	});

	it("a failed read waits for the next tick and keeps what it last reported", () => {
		const [s1] = round(ci.start("pr-74", {pr: 74}, 1000), {state: "pending", head: "a1"});
		const [reading] = ci.ticked(s1, {type: "ci_tick", key: "pr-74", tick: 1});
		const after = ci.failed(reading);

		expect(after).toMatchObject({phase: "waiting", tick: 2, last: "pending"});
		expect(round(after, {state: "pending", head: "a1"})[1]).toBeNull();
	});

	it("a restart mid-read sends the read again and reports no change twice", () => {
		const [s1] = round(ci.start("pr-74", {pr: 74}, 1000), {state: "pending", head: "a1"});
		const [reading] = ci.ticked(s1, {type: "ci_tick", key: "pr-74", tick: 1});
		// The state as a restart loads it: plain data, through JSON.
		const loaded: typeof reading = JSON.parse(JSON.stringify(reading));

		expect(ci.inFlight(loaded)).toEqual({type: "checks_read", key: "pr-74", pr: 74});
		expect(ci.answered(loaded, {state: "pending", head: "a1"})[1]).toBeNull();
		expect(ci.answered(loaded, {state: "red", head: "a1"})[1]).toMatchObject({
			tick: 1,
			value: {state: "red"},
		});
		expect(ci.inFlight(s1)).toBeNull();
	});

	it("its clock is a Listen on tea's built-in timer, on only while the parent holds a poll", () => {
		const clock = listen("timer", (p: {ci: ReturnType<typeof ci.start> | null}) =>
			p.ci === null ? null : ci.clock(p.ci),
		);
		expect(clock.deps({ci: null})).toBeNull();
		expect(clock.deps({ci: ci.start("pr-74", {pr: 74}, 1000)})).toMatchObject({ms: 1000});
	});
});
