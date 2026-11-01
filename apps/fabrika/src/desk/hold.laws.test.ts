import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Hold, type HoldCmd, holdMachine, type Key, pass, press} from "./hold.ts";

// The laws of the page's keys while the host decides (hold.ts), on tea's pbt: after every step of
// any list of Msgs, from the real init. The host's answers come in any order, late, for keys long
// gone, or never, and the link drops when it likes. Each key pressed carries its place in the list
// (`press.code`), so a law can follow one key to where it went.

type Machine = typeof holdMachine;
type Msg = MsgOf<Machine>;
type HoldStep = Step<Hold, Msg, HoldCmd>;

const NAMES = ["<c-b>", "<c-c>", "|", "l", "y"] as const;
const keyOf = (name: string, code = ""): Key => ({
	name,
	press: {key: name, code, ctrl: name.startsWith("<c-"), alt: false, meta: false, shift: false},
});
const key = fc.constantFrom(...NAMES).map((name) => keyOf(name));

/** A Cmd's failed answer. The hold's Cmds declare no errors, so a malformed answer is the one left. */
const failed = <T extends string, C>(type: T, cmd: C) =>
	fc.constant({type, cmd, error: {_tag: "malformed_result", issues: []} as const, at: 0});
const pressing = press({id: 0, key: "<c-b>"});
const passing = pass({key: keyOf("l"), held: false});

/** One entry per Msg type, the Cmds' answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	takes: arbRecordMsg("takes", {
		takes: fc.record({all: fc.boolean(), keys: fc.subarray(["<c-b>", "<c-c>", "|"])}),
	}),
	key: arbRecordMsg("key", {key}),
	answer: arbRecordMsg("answer", {id: fc.nat({max: 5}), took: fc.boolean()}),
	down: arbConstantMsg("down"),
	press_ok: fc.constant(press.ok(pressing, null, 0)),
	press_err: failed(press.errType, pressing),
	pass_ok: fc.constant(pass.ok(passing, null, 0)),
	pass_err: failed(pass.errType, passing),
};

/** Each key gets its place in the list as its `code`, so no two keys are the same. */
const named = (msgs: readonly Msg[]): readonly Msg[] =>
	msgs.map((msg, at) => (msg.type === "key" ? {...msg, key: keyOf(msg.key.name, `k${at}`)} : msg));
const lists = fc
	.array(arbMsg(table, {weights: {key: 6, answer: 4, takes: 2, down: 1}}), {
		maxLength: 40,
		size: "max",
	})
	.map(named);
const OPTS = {numRuns: 400, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const everyStep = (name: string, holds: (step: HoldStep) => boolean): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, holds, OPTS),
});

const presses = (cmds: readonly HoldCmd[]) => cmds.flatMap((c) => (c.type === "press" ? [c] : []));
const passes = (cmds: readonly HoldCmd[]) => cmds.flatMap((c) => (c.type === "pass" ? [c] : []));
/** Does the desk take this key, as the host said last, with the link up? */
const takes = (s: Hold, k: Key) => s.up && (s.takes.all || s.takes.keys.includes(k.name));
/** Is this Msg what frees the key out: its answer, or the link dropping? */
const frees = (s: Hold, msg: Msg) =>
	s.waiting !== null && ((msg.type === "answer" && msg.id === s.waiting.id) || msg.type === "down");

/** Where each key went over a whole list: by its code, in the order it left the page. */
const followed = (steps: readonly HoldStep[]) => {
	const pressed: string[] = [];
	const left: string[] = [];
	const passed: string[] = [];
	const refused = new Set<string>();
	for (const {prev, msg, next, cmds} of steps) {
		if (msg.type === "answer" && !msg.took && prev.waiting?.id === msg.id)
			refused.add(prev.waiting.key.press.code);
		for (const c of cmds) {
			// A press goes with the key it leaves out, under the same id.
			const code =
				c.type === "pass"
					? c.key.press.code
					: next.waiting?.id === c.id
						? next.waiting.key.press.code
						: `id ${c.id}`;
			(c.type === "pass" ? passed : pressed).push(code);
			if (!left.includes(code)) left.push(code);
		}
	}
	const order = steps.flatMap(({msg}) => (msg.type === "key" ? [msg.key.press.code] : []));
	return {order, pressed, passed, left, refused};
};

const inOrderOf = (order: readonly string[], seen: readonly string[]) =>
	seen.every((code, at) => at === 0 || order.indexOf(code) > order.indexOf(seen[at - 1] ?? ""));

// ---------------------------------------------------------------- never wrong

const oneOut = everyStep(
	"one key at most is out at the host: a key is sent only when none is out, and it is then the one out",
	({prev, msg, next, cmds}) => {
		const sent = presses(cmds);
		if (sent.length === 0) return true;
		const [only] = sent;
		return (
			sent.length === 1 &&
			only !== undefined &&
			next.waiting?.id === only.id &&
			next.waiting.key.name === only.key &&
			(prev.waiting === null || frees(prev, msg))
		);
	},
);

const freshIds = everyStep(
	"each key sent goes with an id never used before",
	({prev, next, cmds}) =>
		next.next >= prev.next && presses(cmds).every((c) => c.id >= prev.next && c.id < next.next),
);

const quietWhenDown = everyStep(
	"while the link is down, no key is sent to the host",
	({next, cmds}) => next.up || presses(cmds).length === 0,
);

const staleAnswer = everyStep(
	"an answer that is not for the key out changes nothing",
	({prev, msg, next, cmds}) =>
		msg.type !== "answer" ||
		prev.waiting?.id === msg.id ||
		(JSON.stringify(next) === JSON.stringify(prev) && cmds.length === 0),
);

const inOrder: Law = {
	name: "keys leave the page in the order they were pressed, and reach the tile in that order",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(steps) => {
				const {order, pressed, passed, left} = followed(steps);
				return (
					inOrderOf(order, left) &&
					inOrderOf(order, pressed) &&
					inOrderOf(order, passed) &&
					new Set(passed).size === passed.length &&
					new Set(pressed).size === pressed.length
				);
			},
			OPTS,
		),
};

const oneWay: Law = {
	name: "a key goes to the tile or to the host; to both only when the host said no to it",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(steps) => {
				const {pressed, passed, refused} = followed(steps);
				return pressed.every((code) => !passed.includes(code) || refused.has(code));
			},
			OPTS,
		),
};

const neverLost: Law = {
	name: "no key is lost: each one reached the tile, went to the host, or still waits its turn",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(steps, last) => {
				const {order, pressed, passed, refused} = followed(steps);
				const waits = last.held.map((k) => k.press.code);
				return order.every(
					(code) =>
						passed.includes(code) ||
						waits.includes(code) ||
						(pressed.includes(code) && !refused.has(code)),
				);
			},
			OPTS,
		),
};

// ---------------------------------------------------------------- something good

const passesAtOnce = everyStep(
	"with no key out, a key the desk does not take goes to the tile at once, as it is",
	({prev, msg, cmds}) =>
		msg.type !== "key" ||
		prev.waiting !== null ||
		takes(prev, msg.key) ||
		JSON.stringify(cmds) === JSON.stringify([pass({key: msg.key, held: false})]),
);

const takenGoesUp = everyStep(
	"with no key out and the link up, a key the desk takes goes to the host at once",
	({prev, msg, cmds}) =>
		msg.type !== "key" ||
		prev.waiting !== null ||
		!takes(prev, msg.key) ||
		JSON.stringify(cmds) === JSON.stringify([press({id: prev.next, key: msg.key.name})]),
);

const answerMoves = everyStep(
	"the answer for the key out lets the keys held go on: one is out next, or none is left held",
	({prev, msg, next, cmds}) => {
		if (msg.type !== "answer" || prev.waiting?.id !== msg.id) return true;
		const back = passes(cmds)[0];
		const refusedFirst =
			msg.took || (back?.held === true && back.key.press.code === prev.waiting.key.press.code);
		return refusedFirst && (next.waiting !== null || next.held.length === 0);
	},
);

const downReleases = everyStep(
	"when the link drops, every key held goes on to the tile, in order, and none is out",
	({prev, msg, next, cmds}) =>
		msg.type !== "down" ||
		(next.waiting === null &&
			next.held.length === 0 &&
			!next.up &&
			JSON.stringify(cmds) === JSON.stringify(prev.held.map((k) => pass({key: k, held: true})))),
);

const LAWS = [
	oneOut,
	freshIds,
	quietWhenDown,
	staleAnswer,
	inOrder,
	oneWay,
	neverLost,
	passesAtOnce,
	takenGoesUp,
	answerMoves,
	downReleases,
];

/** The names of the laws `machine` breaks. */
const broken = (machine: Machine): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// ---------------------------------------------------------------- planted mistakes

const real = holdMachine.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...holdMachine,
	update: {...real, ...update},
});

const PLANTS = {
	/** A key the desk takes is sent even while one is out. */
	sendsWhileOut: plant({
		key: (s, m) =>
			s.waiting !== null && takes(s, m.key)
				? [
						{...s, waiting: {id: s.next, key: m.key}, next: s.next + 1},
						[press({id: s.next, key: m.key.name})],
					]
				: real.key(s, m),
	}),
	/** The id is not moved on, so the next key is sent under the same one. */
	reusesIds: plant({
		key: (s, m) => {
			const [next, cmds] = real.key(s, m);
			return [{...next, next: s.next}, cmds];
		},
	}),
	/** A key is sent to the host while the link is down. */
	sendsWhenDown: plant({
		key: (s, m) => {
			if (s.up) return real.key(s, m);
			const [next, cmds] = real.key({...s, up: true}, m);
			return [{...next, up: false}, cmds];
		},
	}),
	/** Any answer counts as the answer for the key out. */
	answersAnyId: plant({
		answer: (s, m) => (s.waiting === null ? [s, []] : real.answer(s, {...m, id: s.waiting.id})),
	}),
	/** The keys held come out last first. */
	releasesBackwards: plant({
		answer: (s, m) =>
			real.answer(s.waiting?.id === m.id ? {...s, held: [...s.held].reverse()} : s, m),
	}),
	/** A key the host said no to is dropped. */
	dropsRefused: plant({
		answer: (s, m) => real.answer(s, {...m, took: true}),
	}),
	/** A key the host took goes to the tile too. */
	passesTaken: plant({
		answer: (s, m) => real.answer(s, {...m, took: false}),
	}),
	/** A key the desk does not take is held back, with nothing out. */
	holdsFreeKeys: plant({
		key: (s, m) =>
			s.waiting === null && !takes(s, m.key)
				? [{...s, held: [...s.held, m.key]}, []]
				: real.key(s, m),
	}),
	/** A key the desk takes is held, with nothing out, until the next answer. */
	holdsTakenKeys: plant({
		key: (s, m) =>
			s.waiting === null && takes(s, m.key)
				? [{...s, held: [...s.held, m.key]}, []]
				: real.key(s, m),
	}),
	/** The answer frees the key out and forgets to let the held keys go on. */
	answerForgetsHeld: plant({
		answer: (s, m) => {
			if (s.waiting === null || s.waiting.id !== m.id) return [s, []];
			const back = m.took ? [] : [pass({key: s.waiting.key, held: true})];
			return [{...s, waiting: null}, back];
		},
	}),
	/** The link drops and the held keys stay held. */
	downKeepsHeld: plant({down: (s) => [{...s, waiting: null, up: false}, []]}),
} satisfies Record<string, Machine>;

describe("the hold's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(holdMachine);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			sendsWhileOut: [oneOut.name, inOrder.name],
			reusesIds: [freshIds.name],
			// Down, the desk takes no key, so the key should have gone to the tile.
			sendsWhenDown: [quietWhenDown.name, passesAtOnce.name],
			answersAnyId: [oneOut.name, staleAnswer.name, oneWay.name],
			releasesBackwards: [inOrder.name],
			dropsRefused: [neverLost.name, answerMoves.name],
			passesTaken: [oneWay.name],
			holdsFreeKeys: [inOrder.name, passesAtOnce.name],
			holdsTakenKeys: [inOrder.name, takenGoesUp.name],
			answerForgetsHeld: [inOrder.name, answerMoves.name],
			downKeepsHeld: [inOrder.name, downReleases.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});
