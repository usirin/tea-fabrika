import {msgKeysOf} from "@demlik/tea";
import {session} from "../agents/acp/session.ts";
import {build} from "../stages/build/machine.ts";
import {loop} from "../stages/operate/machine.ts";
import {queue} from "../stages/queue.ts";
import {MAX_WAITS as REVIEW_WAITS, review} from "../stages/review/machine.ts";
import {MAX_WAITS as SHIP_WAITS, ship} from "../stages/ship/machine.ts";
import * as buildLaws from "./build.ts";
import {explore, type Law, pathText, type Update, type World} from "./explore.ts";
import * as loopLaws from "./loop.ts";
import * as queueLaws from "./queue.ts";
import * as reviewLaws from "./review.ts";
import * as sessionLaws from "./session.ts";
import * as shipLaws from "./ship.ts";

// Every tea machine's laws, in one list. The standard test (standard.test.ts)
// finds each machine in the source by how it is made, and fails when one has
// no entry here. Each entry is checked in the normal test suite: no law
// broken, and every Msg type the machine takes sent at least once, so no law
// holds only because the Msg that would break it never came.
//
// Each search here is kept short, to keep the suite fast. Longer runs and
// the blowup tables are in experiment 90's script.

/** What one check found. */
export interface Checked {
	/** Every Msg type the machine has a cell for. */
	readonly alphabet: readonly string[];
	/** Msg types in the alphabet that no search sent. Empty, or the spec fails. */
	readonly unsent: readonly string[];
	/** Each broken law, by name, as its shortest breaking sequence. */
	readonly broken: Readonly<Record<string, string>>;
	/** Each search walked every state it could reach, before its depth bound. */
	readonly complete: boolean;
	readonly states: number;
	readonly ms: number;
}

export interface Spec {
	readonly name: string;
	/** The file the machine is made in, from `wip/src`. */
	readonly file: string;
	readonly check: () => Checked;
}

/** One search of a machine: a world, and how deep to walk it. */
export interface Walk<S, M, C> {
	readonly world: World<S, M, C>;
	readonly depth: number;
}

/**
 * A machine's laws spec. It may walk more than one world: the Msg types it
 * sends are counted across all of them.
 */
export function spec<S, M extends {readonly type: string}, C>(parts: {
	readonly name: string;
	readonly file: string;
	readonly machine: {readonly update: object};
	readonly init: S;
	readonly update: Update<S, M, C>;
	readonly laws: () => readonly Law<S, M, C>[];
	readonly show: (m: M) => string;
	readonly walks: readonly [Walk<S, M, C>, ...Walk<S, M, C>[]];
}): Spec {
	return {
		name: parts.name,
		file: parts.file,
		check: () => {
			const alphabet = [...msgKeysOf(parts.machine)].sort();
			const sent = new Set<string>();
			const broken: Record<string, string> = {};
			let complete = true;
			let states = 0;
			let ms = 0;
			for (const walk of parts.walks) {
				const r = explore({
					init: parts.init,
					update: parts.update,
					world: walk.world,
					laws: parts.laws(),
					depth: walk.depth,
				});
				for (const t of r.sent) sent.add(t);
				for (const b of r.broken) broken[b.law] ??= pathText(b.path, parts.show);
				complete &&= r.complete;
				states += r.states;
				ms += r.ms;
			}
			const unsent = alphabet.filter((t) => !sent.has(t));
			return {alphabet, unsent, broken, complete, states, ms};
		},
	};
}

export const SPECS: readonly Spec[] = [
	spec({
		name: "ship",
		file: "stages/ship/machine.ts",
		machine: ship,
		init: shipLaws.shipInit,
		update: shipLaws.shipStep,
		laws: shipLaws.shipLaws,
		show: shipLaws.showShipMsg,
		walks: [{world: shipLaws.shipWorld(), depth: 2 * SHIP_WAITS + 20}],
	}),
	spec({
		name: "review",
		file: "stages/review/machine.ts",
		machine: review,
		init: reviewLaws.reviewInit,
		update: reviewLaws.reviewStep,
		laws: reviewLaws.reviewLaws,
		show: reviewLaws.showReviewMsg,
		walks: [{world: reviewLaws.reviewWorld(), depth: 2 * REVIEW_WAITS + 8}],
	}),
	spec({
		name: "build",
		file: "stages/build/machine.ts",
		machine: build,
		init: buildLaws.buildInit,
		update: buildLaws.buildStep,
		laws: buildLaws.buildLaws,
		show: buildLaws.showBuildMsg,
		walks: [{world: buildLaws.buildWorld(), depth: 10}],
	}),
	spec({
		name: "operate loop",
		file: "stages/operate/machine.ts",
		machine: loop,
		init: loopLaws.loopInit,
		update: loopLaws.loopStep,
		laws: loopLaws.loopLaws,
		show: loopLaws.showLoopMsg,
		walks: [{world: loopLaws.loopWorld(), depth: 12}],
	}),
	spec({
		name: "queue",
		file: "stages/queue.ts",
		machine: queue,
		init: queueLaws.queueInit,
		update: queueLaws.queueStep,
		laws: queueLaws.queueLaws,
		show: queueLaws.showQueueMsg,
		walks: [{world: queueLaws.queueWorld(), depth: 12}],
	}),
	spec({
		name: "acp session",
		file: "agents/acp/session.ts",
		machine: session,
		init: sessionLaws.sessionInit,
		update: sessionLaws.sessionStep,
		laws: sessionLaws.sessionLaws,
		show: sessionLaws.showSessionMsg,
		walks: [{world: sessionLaws.sessionWorld(), depth: 6}],
	}),
];
