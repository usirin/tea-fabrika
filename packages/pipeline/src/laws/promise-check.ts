import type {ShipCmd} from "../stages/ship/machine.ts";
import * as explore from "./explore.ts";
import * as review from "./review.ts";
import * as ship from "./ship.ts";

// One law on one machine, as a command a promise record names (experiment 117).
//
//   node packages/pipeline/src/laws/promise-check.ts ship "an ended run sends nothing"
//
// It walks every order of messages up to the machine's bound, with that one
// law alone, and prints one verdict line as JSON on stdout, last:
//
//   {"held":true,"checked":"an ended run sends nothing","plant":null,"bound":"...","path":[]}
//
// With PROMISE_PLANT=<name> in the environment it walks the planted copy of
// the machine instead, and says which plant it ran. The runner in
// `@kampus/promises` asks for the plant this way, so the planted break always
// runs the same command as the check. An unknown machine, law or plant is no
// verdict at all: it prints why on stderr and exits 2.
//
// The bounds are the ones `laws.test.ts` walks: 8 messages for ship, 6 for review.

interface Machine {
	readonly depth: number;
	run(law: string, plant: string | null): explore.Report<unknown> | string;
	show(path: readonly unknown[]): readonly string[];
}

function machine<S, M extends {readonly type: string}, C>(m: {
	readonly depth: number;
	readonly init: S;
	readonly step: explore.Update<S, M, C>;
	readonly world: () => explore.World<S, M, C>;
	readonly laws: () => readonly explore.Law<S, M, C>[];
	readonly plants: Readonly<Record<string, explore.Update<S, M, C>>>;
	readonly show: (msg: M) => string;
}): Machine {
	return {
		depth: m.depth,
		run: (name, plant) => {
			const laws = m.laws().filter((l) => l.name === name);
			if (laws.length !== 1) return `no law named "${name}"`;
			const update = plant === null ? m.step : m.plants[plant];
			if (update === undefined) return `no planted break named "${plant}"`;
			return explore.explore({init: m.init, update, world: m.world(), laws, depth: m.depth});
		},
		show: (path) => path.map((msg, at) => `${at + 1}. ${m.show(msg as M)}`),
	};
}

const MACHINES: Readonly<Record<string, Machine>> = {
	ship: machine<ship.Keeping, ship.AnyShipMsg, ShipCmd>({
		depth: 8,
		init: ship.shipInit,
		step: ship.shipStep,
		world: () => ship.shipWorld(),
		laws: () => ship.shipLaws<ship.Keeping>(),
		plants: {
			forgetsMissingReview: ship.forgetsMissingReview,
			skipsTheRead: ship.skipsTheRead,
			keepsAnOldPass: ship.keepsAnOldPass,
			landsAnyHead: ship.landsAnyHead,
			takesAnOldVersion: ship.takesAnOldVersion,
			actsAfterTheEnd: ship.actsAfterTheEnd,
		},
		show: ship.showShipMsg,
	}),
	review: machine({
		depth: 6,
		init: review.reviewInit,
		step: review.reviewStep,
		world: () => review.reviewWorld(),
		laws: () => review.reviewLaws(),
		plants: {
			unseenIsMet: review.unseenIsMet,
			limitIsAPass: review.limitIsAPass,
			takesAnyHead: review.takesAnyHead,
			deviationExcuses: review.deviationExcuses,
			rewordsFromDeviations: review.rewordsFromDeviations,
			judgesTheFirstVersion: review.judgesTheFirstVersion,
			actsAfterTheEnd: review.actsAfterTheEnd,
		},
		show: review.showReviewMsg,
	}),
};

if (import.meta.main) {
	const [name, law] = process.argv.slice(2);
	const plant = process.env.PROMISE_PLANT || null;
	const m = name === undefined ? undefined : MACHINES[name];
	if (m === undefined || law === undefined) {
		process.stderr.write(`usage: promise-check.ts <${Object.keys(MACHINES).join("|")}> "<law>"\n`);
		process.exit(2);
	}
	const report = m.run(law, plant);
	if (typeof report === "string") {
		process.stderr.write(`${report}\n`);
		process.exit(2);
	}
	const found = report.broken.find((b) => b.law === law);
	const verdict = {
		held: found === undefined,
		checked: law,
		plant,
		bound: `every order of messages up to ${m.depth}, ${report.states} states${report.complete ? ", the whole space" : ""}`,
		path: found === undefined ? [] : m.show(found.path),
		why: found?.why ?? null,
	};
	process.stdout.write(`${JSON.stringify(verdict)}\n`);
}
