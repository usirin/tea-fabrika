import {Arbitrary, Effect} from "effect";
import {describe, expect, it} from "vitest";
import * as queue from "./queue.ts";
import {CHOICE, sample} from "./sample.ts";
import {walk, walkEnds, walkWorld} from "./walk.ts";
import {hostedWorld} from "./world/hosted.ts";
import {lanesWorld} from "./world/lanes.ts";
import {LANE_LAWS, oneLaneATicket} from "./world/laws.ts";

// The property-test walker of experiment 118 on the same machines, laws and worlds as our
// checkers. Small runs only; the plants, the budgets and the deep runs are in
// experiments/118-pbt-vs-checker.ts.

const parts = {
	init: queue.queueInit,
	world: queue.queueWorld(),
	laws: queue.queueLaws,
	show: queue.showQueueMsg,
};
const choices = (length: number) => Arbitrary.array(Arbitrary.schema(CHOICE), {maxLength: length});
const holds = (run: (cs: readonly number[]) => boolean, length: number) =>
	Effect.runSync(Arbitrary.checkEffect(choices(length), run, {runs: 200, seed: 118}));

describe("one machine", () => {
	it("a planted mistake is found and shrunk to the checker's own shortest run", () => {
		const machine = {...parts, update: queue.queuesTwice};
		const found = Effect.runSync(
			sample((cs) => walk(machine, cs, "a value is on the queue once"), {
				ms: 5_000,
				seed: 1,
				length: 40,
			}),
		);
		expect(found).toMatchObject({caught: true, path: ["told a", "told a"]});
	});

	it("the real machine keeps every law on 200 walks of up to 40 steps", () => {
		const machine = {...parts, update: queue.queueStep};
		expect(holds((cs) => walk(machine, cs).broke === null, 40)._tag).toBe("Passed");
	});

	it("a swarm mask of 0 turns nothing off", () => {
		const machine = {...parts, update: queue.queuesTwice};
		const cs = [3, 1, 4, 1, 5, 9, 2, 6];
		expect(walk(machine, [0, ...cs], undefined, true)).toEqual(walk(machine, cs));
	});
});

describe("a world of machines", () => {
	it("two lanes with no claim both work one ticket, shrunk to the search's 4 steps", () => {
		const sys = lanesWorld({
			lanes: 2,
			tickets: "same",
			queue: true,
			forms: ["pass"],
			claim: "none",
		});
		const found = Effect.runSync(
			sample((cs) => walkWorld(sys, LANE_LAWS, cs, oneLaneATicket.name), {
				ms: 5_000,
				seed: 1,
				length: 60,
			}),
		);
		expect(found.caught).toBe(true);
		expect(found.path).toHaveLength(4);
	});

	it("every lane ends: today's hosted lane goes round a fair loop; the fixed Sub does not", () => {
		const today = hostedWorld({sub: "today"});
		const found = Effect.runSync(
			sample((cs) => walkEnds(today, cs, 400), {ms: 5_000, seed: 1, length: 60}),
		);
		expect(found.caught).toBe(true);
		expect(found.why).toMatch(/fair loop/);
		expect(found.path?.at(-1)).toMatch(/no row yet/);
		const fixed = hostedWorld({sub: "fixed"});
		expect(holds((cs) => walkEnds(fixed, cs, 400).broke === null, 60)._tag).toBe("Passed");
	});
});
