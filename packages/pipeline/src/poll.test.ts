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
	input: Schema.Struct({key: Schema.String, tick: Schema.Number, pr: Schema.Number}),
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
	read: (key, tick, {pr}: {pr: number}) => readChecks({key, tick, pr}),
	by: (checks: Checks) => checks.state,
});
type State = ReturnType<typeof ci.start>;

const pace = {every: 1000, limit: 300};

/** The parent's part: a change becomes a `pr` fact, named by where it stands. */
const fact = (c: Changed<Checks>) =>
	writePr({pr: 74, state: c.value.state, intent: intentOf(c.key, "pr", c.tick)});

/** The clock fires: what it was set for arrives as the Msg. */
const fire = (s: State) => ci.ticked(s, ci.clock(s).msg);

/** One tick and one read, the way a parent's update would step them. */
function round(s: State, value: Checks) {
	const [reading, reads] = fire(s);
	expect(reads).toEqual([{type: "checks_read", key: "pr-74", tick: s.tick, pr: 74}]);
	const [read] = reads;
	if (read === undefined) throw new Error("a waiting poll reads on its tick");
	return ci.answered(reading, read, value);
}

describe("poll: a fact only on change", () => {
	it("pending, pending, green: the first read and the change count, the repeat does not", () => {
		const s0 = ci.start("pr-74", {pr: 74}, {every: 60_000, limit: 10_000});
		expect(ci.clock(s0)).toEqual({
			ms: 60_000,
			msg: {type: "ci_tick", key: "pr-74", tick: 0, phase: "waiting"},
		});

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
		const [s1] = round(ci.start("pr-74", {pr: 74}, pace), {state: "pending", head: "a1"});
		expect(round(s1, {state: "pending", head: "b2"})[1]).toBeNull();
	});

	it("reads once per tick: a stale tick, another child's tick, or the wait's tick mid-read changes nothing", () => {
		const s0 = ci.start("pr-74", {pr: 74}, pace);
		const [reading] = fire(s0);

		expect(ci.ticked(s0, {type: "ci_tick", key: "pr-74", tick: 5, phase: "waiting"})).toEqual([
			s0,
			[],
		]);
		expect(ci.ticked(s0, {type: "ci_tick", key: "pr-75", tick: 0, phase: "waiting"})).toEqual([
			s0,
			[],
		]);
		expect(ci.ticked(reading, ci.clock(s0).msg)).toEqual([reading, []]);
	});

	it("a failed read waits for the next tick and keeps what it last reported", () => {
		const [s1] = round(ci.start("pr-74", {pr: 74}, pace), {state: "pending", head: "a1"});
		const [reading, [read]] = fire(s1);
		if (read === undefined) throw new Error("a waiting poll reads on its tick");
		const after = ci.failed(reading, read);

		expect(after).toMatchObject({phase: "waiting", tick: 2, last: "pending"});
		expect(round(after, {state: "pending", head: "a1"})[1]).toBeNull();
	});

	it("a restart mid-read sends the read again and reports no change twice", () => {
		const [s1] = round(ci.start("pr-74", {pr: 74}, pace), {state: "pending", head: "a1"});
		const [reading] = fire(s1);
		// The state as a restart loads it: plain data, through JSON.
		const loaded: typeof reading = JSON.parse(JSON.stringify(reading));
		const again = ci.inFlight(loaded);

		expect(again).toEqual({type: "checks_read", key: "pr-74", tick: 1, pr: 74});
		if (again === null) throw new Error("a read is out");
		expect(ci.answered(loaded, again, {state: "pending", head: "a1"})[1]).toBeNull();
		expect(ci.answered(loaded, again, {state: "red", head: "a1"})[1]).toMatchObject({
			tick: 1,
			value: {state: "red"},
		});
		expect(ci.inFlight(s1)).toBeNull();
	});

	it("its clock is a Listen on tea's built-in timer, on while the parent holds a poll", () => {
		const clock = listen("timer", (p: {ci: State | null}) =>
			p.ci === null ? null : ci.clock(p.ci),
		);
		expect(clock.deps({ci: null})).toBeNull();
		expect(clock.deps({ci: ci.start("pr-74", {pr: 74}, pace)})).toMatchObject({ms: 1000});
	});
});

describe("poll: a read that never answers does not stop it", () => {
	it("the clock stays on while reading, set to the limit, and its tick counts as a failed read", () => {
		const [s1] = round(ci.start("pr-74", {pr: 74}, pace), {state: "pending", head: "a1"});
		const [stuck] = fire(s1);

		expect(ci.clock(stuck)).toEqual({
			ms: 300,
			msg: {type: "ci_tick", key: "pr-74", tick: 1, phase: "reading"},
		});
		const [gaveUp, reads] = fire(stuck);
		expect(reads).toEqual([]);
		expect(gaveUp).toMatchObject({phase: "waiting", tick: 2, last: "pending"});
		expect(ci.clock(gaveUp)).toMatchObject({ms: 1000, msg: {tick: 2, phase: "waiting"}});

		// It keeps polling: the next tick reads again, and a change still counts.
		const [, changed] = round(gaveUp, {state: "green", head: "a1"});
		expect(changed).toMatchObject({tick: 2, value: {state: "green"}});
	});

	it("a late answer for a read given up is ignored; the current read's answer still counts", () => {
		const [s1] = round(ci.start("pr-74", {pr: 74}, pace), {state: "pending", head: "a1"});
		const [stuck, [late]] = fire(s1);
		if (late === undefined) throw new Error("a waiting poll reads on its tick");
		const [gaveUp] = fire(stuck);

		// Late while waiting: nothing changes, and no change is reported.
		expect(ci.answered(gaveUp, late, {state: "red", head: "a1"})).toEqual([gaveUp, null]);
		expect(ci.failed(gaveUp, late)).toEqual(gaveUp);

		// Late while the next read is out: still nothing, and that read is still out.
		const [reading, [current]] = fire(gaveUp);
		if (current === undefined) throw new Error("a waiting poll reads on its tick");
		expect(ci.answered(reading, late, {state: "red", head: "a1"})).toEqual([reading, null]);
		expect(ci.failed(reading, late)).toEqual(reading);

		const [after, changed] = ci.answered(reading, current, {state: "green", head: "a1"});
		expect(changed).toMatchObject({tick: 2, value: {state: "green"}});
		expect(after).toMatchObject({phase: "waiting", tick: 3, last: "green"});
	});

	it("the same number for `every` and `limit` still sets a new clock when the read starts", () => {
		const s0 = ci.start("pr-74", {pr: 74}, {every: 500, limit: 500});
		const [reading] = fire(s0);
		expect(ci.clock(reading)).not.toEqual(ci.clock(s0));
	});
});
