import {describe, expect, it} from "vitest";
import {explore, law, pathText, type Update, type World, watched} from "./explore.ts";

// The runner on a toy: a machine that asks for one tick at a time and counts
// the answers, up to three.

type Toy = {readonly n: number; readonly waiting: boolean};
type ToyMsg = {readonly type: "go"} | {readonly type: "tock"} | {readonly type: "resume"};
type ToyCmd = {readonly type: "tick"};

const toy: Update<Toy, ToyMsg, ToyCmd> = (s, m) => {
	switch (m.type) {
		case "go":
			return s.waiting ? [s, []] : [{...s, waiting: true}, [{type: "tick"}]];
		case "tock":
			return s.waiting ? [{n: Math.min(s.n + 1, 3), waiting: false}, []] : [s, []];
		case "resume":
			return s.waiting ? [s, [{type: "tick"}]] : [s, []];
	}
};
/** A planted mistake: a tock counts even when nothing was asked. */
const sloppy: Update<Toy, ToyMsg, ToyCmd> = (s, m) =>
	m.type === "tock" ? [{n: Math.min(s.n + 1, 3), waiting: false}, []] : toy(s, m);

const world = (echoes = false): World<Toy, ToyMsg, ToyCmd> => ({
	outside: () => [{type: "go"}, {type: "resume"}],
	answers: () => [{type: "tock"}],
	restart: (m) => m.type === "resume",
	echoes,
});
const init: Toy = {n: 0, waiting: false};
const belowTwo = law<Toy, ToyMsg, ToyCmd>("n stays below 2", (step) =>
	step.next.n >= 2 ? `n is ${step.next.n}` : null,
);
const show = (m: ToyMsg) => m.type;

describe("explore", () => {
	it("finds the shortest sequence that breaks a law", () => {
		const r = explore({init, update: toy, world: world(), laws: [belowTwo], depth: 10});
		expect(r.broken.map((b) => [b.law, b.why, pathText(b.path, show)])).toEqual([
			["n stays below 2", "n is 2", "1. go\n2. tock\n3. go\n4. tock"],
		]);
	});

	it("keeps each state once and says when nothing is left", () => {
		const r = explore({init, update: toy, world: world(), laws: [], depth: 20});
		// n is 0 to 3, each idle or waiting; a waiting toy always has its tick in flight,
		// because a restart sends it again.
		expect({states: r.states, complete: r.complete, capped: r.capped}).toEqual({
			states: 8,
			complete: true,
			capped: false,
		});
	});

	it("says when the bound cut the search short", () => {
		const r = explore({init, update: toy, world: world(), laws: [], depth: 2});
		expect(r.complete).toBe(false);
		expect(explore({init, update: toy, world: world(), laws: [], depth: 20, most: 5}).capped).toBe(
			true,
		);
	});

	it("tries an answer twice only with echoes on", () => {
		const plain = explore({init, update: sloppy, world: world(), laws: [belowTwo], depth: 6});
		const echoed = explore({init, update: sloppy, world: world(true), laws: [belowTwo], depth: 6});
		expect(plain.broken.map((b) => pathText(b.path, show))).toEqual([
			"1. go\n2. tock\n3. go\n4. tock",
		]);
		expect(echoed.broken.map((b) => pathText(b.path, show))).toEqual(["1. go\n2. tock\n3. tock"]);
	});

	it("drops the Cmds in flight on a restart", () => {
		// Without the restart, a resend lands beside the old tick and one go can be answered twice.
		const kept = {...world(), restart: () => false};
		const twice = explore({init, update: sloppy, world: kept, laws: [belowTwo], depth: 6});
		const dropped = explore({init, update: sloppy, world: world(), laws: [belowTwo], depth: 6});
		expect(twice.broken.map((b) => pathText(b.path, show))).toEqual([
			"1. go\n2. resume\n3. tock\n4. tock",
		]);
		expect(dropped.broken.map((b) => pathText(b.path, show))).toEqual([
			"1. go\n2. tock\n3. go\n4. tock",
		]);
	});

	it("keeps two paths apart when a law remembers different things on them", () => {
		// The same machine state, reached with and without a resume on the way.
		const resumed = watched<Toy, ToyMsg, ToyCmd, boolean>(
			"remembers a resume",
			false,
			(seen, step) => seen || step.msg.type === "resume",
		);
		const without = explore({init, update: toy, world: world(), laws: [], depth: 20});
		const withIt = explore({init, update: toy, world: world(), laws: [resumed], depth: 20});
		expect(withIt.states).toBeGreaterThan(without.states);
	});

	it("records a reducer that throws as a broken law", () => {
		const throws: Update<Toy, ToyMsg, ToyCmd> = (s, m) => {
			if (s.n === 1 && m.type === "go") throw new Error("one is too many");
			return toy(s, m);
		};
		const r = explore({init, update: throws, world: world(), laws: [], depth: 6});
		expect(r.broken.map((b) => [b.law, b.why, pathText(b.path, show)])).toEqual([
			["update throws", "Error: one is too many", "1. go\n2. tock\n3. go"],
		]);
	});
});
