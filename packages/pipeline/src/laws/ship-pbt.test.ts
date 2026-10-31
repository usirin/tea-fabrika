import {applyCell, type Sub} from "@demlik/tea";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import type {ShipFacts} from "../stages/ship/facts.ts";
import {
	DEFAULT_WAITS,
	readShipFacts,
	type Ship,
	type ShipCmd,
	ship,
} from "../stages/ship/machine.ts";
import {CRITERIA, metAt, ON_TIP} from "../stages/ship/scripted.ts";
import * as pbt from "./ship-pbt.ts";
import * as old from "./ship.ts";

const OPTS = {numRuns: 2000, seed: 1};

/** The law a property found broken on `machine`, and why; `null`: it held. */
function caught<S extends Ship, U extends Sub>(
	property: pbt.Property,
	machine: pbt.ShipLike<S, U>,
	opts: pbt.Opts = OPTS,
): {readonly law: string; readonly why: string} | null {
	try {
		property.run(machine, opts);
		return null;
	} catch (e) {
		if (e instanceof Error && e.cause instanceof pbt.LawBroken)
			return {law: e.cause.law, why: e.cause.why};
		throw e;
	}
}

/** The names of the laws in `properties` that `machine` breaks. */
const breaks = <S extends Ship, U extends Sub>(
	properties: readonly pbt.Property[],
	machine: pbt.ShipLike<S, U>,
): readonly string[] => properties.flatMap((p) => (caught(p, machine) === null ? [] : [p.name]));

/** The real ship machine with one step changed after it runs: a planted mistake for a new law. */
const after = (
	change: (prev: Ship, msg: pbt.AnyShipMsg, next: Ship) => Ship,
): pbt.ShipLike<Ship, never> =>
	pbt.planted<Ship>({phase: "idle"}, (s, m) => {
		const [next, cmds] = applyCell<Ship, pbt.AnyShipMsg, ShipCmd>(ship, s, m);
		return [change(s, m, next), cmds];
	});

const READY: ShipFacts = {
	head: "A",
	state: "open",
	ours: true,
	ticket: {id: "o/r#1", link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: ON_TIP,
	criteria: CRITERIA,
	verdicts: metAt("A"),
};
const reads = readShipFacts({pr: pbt.PR});

describe("ship, as property tests", () => {
	it("the real machine holds every law, today's five and the two new ones", () => {
		expect(breaks(pbt.RUN_2, ship)).toEqual([]);
	});

	it("regression: a failed review beside a passed one is not shipped (was experiment 90's 2-message break)", () => {
		const failedBeside = readShipFacts.ok(
			reads,
			{
				...READY,
				reviews: [
					{kind: "review-code", verdict: "passed"},
					{kind: "review-doc", verdict: "failed"},
				],
			},
			0,
		);
		const list = fc.constant([{type: "start" as const, pr: pbt.PR}, failedBeside]);
		const once = pbt.TODAY.map((law): pbt.Property => ({
			name: law.name,
			run: (m, o) => pbt.holds(m, law, o, list),
		}));
		expect(breaks(once, ship)).toEqual([]);
		const [end] = applyCell<Ship, pbt.AnyShipMsg, ShipCmd>(
			ship,
			{
				phase: "reading",
				pr: pbt.PR,
				waits: DEFAULT_WAITS,
				moves: 0,
				rerunFor: null,
				waited: 0,
				asked: reads,
			},
			failedBeside,
		);
		expect(end).toMatchObject({
			phase: "over",
			outcome: {kind: "send", to: "builder", why: "review_failed"},
		});
	});

	it("each planted mistake of ./ship.ts is caught, and each of today's laws is seen to fail", () => {
		const plants = {
			forgetsMissingReview: old.forgetsMissingReview,
			skipsTheRead: old.skipsTheRead,
			takesAnOldVersion: old.takesAnOldVersion,
			keepsAnOldPass: old.keepsAnOldPass,
			landsAnyHead: old.landsAnyHead,
			actsAfterTheEnd: old.actsAfterTheEnd,
		};
		const found = Object.fromEntries(
			Object.entries(plants).map(([name, plant]) => [
				name,
				breaks(pbt.RUN_1, pbt.planted<old.Keeping>(old.shipInit, plant)),
			]),
		);
		const [ready, carries, otherHead, onlySent, ended] = pbt.TODAY.map((law) => law.name);
		expect(found).toEqual({
			forgetsMissingReview: [ready, otherHead],
			skipsTheRead: [ready, carries],
			takesAnOldVersion: [ready, carries],
			keepsAnOldPass: [ready, otherHead],
			landsAnyHead: [onlySent],
			actsAfterTheEnd: [ended],
		});
	});

	it("a failed tidy-up told as done breaks the outcome law", () => {
		const saysDone = after((prev, msg, next) =>
			prev.phase === "finishing" && msg.type === "ship_finish_err" && next.phase === "over"
				? {...next, outcome: {...next.outcome, cleanup: "done"}}
				: next,
		);
		expect(breaks(pbt.RUN_2, saysDone)).toEqual([
			pbt.GIVES_ITS_OUTCOME.name,
			pbt.LANDS_WHEN_READY.name,
		]);
	});

	it("a run that waits forever when there is no merge queue breaks only 'a ready pull request lands'", () => {
		const waitsForAQueue = after((prev, msg, next) =>
			prev.phase === "enqueueing" && msg.type === "ship_enqueue_ok" && msg.value === "no_queue"
				? prev
				: next,
		);
		expect(breaks(pbt.RUN_2, waitsForAQueue)).toEqual([pbt.LANDS_WHEN_READY.name]);
	});

	it("the generator reaches every phase, and a landing both whole and in part", () => {
		const {phases, outcomes} = pbt.reach(2000, 7);
		expect(Object.keys(phases).sort()).toEqual(
			[
				"idle",
				"reading",
				"rerunning",
				"waiting",
				"enqueueing",
				"merging",
				"queued",
				"finishing",
				"over",
			].sort(),
		);
		expect(outcomes).toHaveProperty("done");
		expect(outcomes).toHaveProperty("done:part");
	});

	it("a run from a saved state holds when the write in flight is for the state's own head", () => {
		expect(() => pbt.fromSavedState(OPTS, true)).not.toThrow();
	});

	// A finding of experiment 121, left in place so the mutants match experiment 119's. A state
	// read back from storage is checked proof by proof, not that its two proofs name one head.
	it("finding: a saved state whose two proofs name different heads lands a head it never sent", () => {
		let why = "";
		try {
			pbt.fromSavedState({numRuns: 5000, seed: 1});
		} catch (e) {
			if (e instanceof Error && e.cause instanceof pbt.LawBroken) why = e.cause.why;
		}
		expect(why).toMatch(/^landed [AB], and the heads sent were [AB]/);
	});
});
