import {structuralHash} from "@demlik/tea";
import {Broke, type Law, type Step, type Update, type Watch, type World} from "./explore.ts";
import type {Safety, System} from "./world/search.ts";

// One walk through the same machines, laws and worlds our checkers search,
// for a property test (experiment 118; the test itself is `./sample.ts`).
// Where `explore.ts` and `world/search.ts` try every order up to a bound, a
// property test tries random ones, walked here, and shrinks the first that
// breaks a law. Plain functions, so the property can be pure.
//
// One input is a list of numbers, the choices. A walk starts at the first
// state; at each step it lists every move the world could make next, the
// same list the checker makes, and takes move number `choice % count`. So
// the property test uses the world's own alphabet, and a shrunk input (fewer
// choices, each nearer 0) is a shorter or plainer run. Each law is checked
// after every step, as the checker does.
//
// The "eventually" laws ("every lane ends") are checked on the walk itself:
//   - a dead state: a lane has not ended and nothing that must happen can;
//   - a fair loop: the walk comes back to a state it saw, the lane is open
//     the whole way round, and every fairness class possible in every state
//     of the loop is taken in it. The choices are used round and round, so a
//     walk can go round a loop for good.
// What that misses: a loop the walk never closes, and a lane that runs on
// without ever repeating a state.

/** One step of a walk, by its printed name. */
export interface Walked {
	/** The law broken, or `null`: none broke on this walk. */
	readonly broke: {readonly law: string; readonly why: string} | null;
	/** The steps taken, up to and with the one that broke the law. */
	readonly path: readonly string[];
}

// ---------------------------------------------------------------- one machine

/** One machine, as `explore` takes it. */
export interface Machine<S, M, C> {
	readonly init: S;
	readonly update: Update<S, M, C>;
	readonly world: World<S, M, C>;
	readonly laws: () => readonly Law<S, M, C>[];
	readonly show: (msg: M) => string;
}

interface Flight<C> {
	readonly key: string;
	readonly cmd: C;
}

interface At<S, M, C> {
	readonly state: S;
	readonly flight: readonly Flight<C>[];
	readonly echoes: readonly M[];
}

interface Next<M, C> {
	readonly msg: M;
	readonly flight: readonly Flight<C>[];
	readonly echoes: readonly M[];
	readonly echo: boolean;
}

/** Every move the world may make: the same list, in the same order, as `explore` makes. */
function nextOf<S, M, C>(world: World<S, M, C>, at: At<S, M, C>): readonly Next<M, C>[] {
	const out: Next<M, C>[] = [];
	for (const msg of world.outside(at.state)) {
		const restart = world.restart?.(msg) ?? false;
		out.push({
			msg,
			flight: restart ? [] : at.flight,
			echoes: restart ? [] : at.echoes,
			echo: false,
		});
	}
	at.flight.forEach((f, i) => {
		if (i > 0 && at.flight[i - 1]?.key === f.key) return;
		const rest = [...at.flight.slice(0, i), ...at.flight.slice(i + 1)];
		for (const msg of world.answers(f.cmd))
			out.push({msg, flight: rest, echoes: at.echoes, echo: true});
	});
	at.echoes.forEach((msg, i) => {
		const rest = [...at.echoes.slice(0, i), ...at.echoes.slice(i + 1)];
		out.push({msg, flight: at.flight, echoes: rest, echo: false});
	});
	return out;
}

const fly = <C>(flight: readonly Flight<C>[], cmds: readonly C[]): readonly Flight<C>[] =>
	cmds.length === 0
		? flight
		: [...flight, ...cmds.map((cmd) => ({key: structuralHash(cmd), cmd}))].sort((a, b) =>
				a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
			);

/** One of 16 bits for a Msg type, for a swarm mask. */
const bitOf = (type: string): number => {
	let h = 0;
	for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) | 0;
	return 1 << ((h >>> 0) % 16);
};

/**
 * Walk one machine by the choices. Stops at the first break of `target` (or
 * of any law, with no target), when the world has no move, or when the
 * choices run out. A reducer that throws is the law "update throws".
 *
 * `swarm` (swarm testing, Groce et al. 2012): the first choice is a mask
 * that turns some Msg types off for the whole walk, so a walk can go deep
 * along the types left on. A mask of 0 turns nothing off, and a step where
 * every move is off takes from all of them.
 */
export function walk<S, M extends {readonly type: string}, C>(
	machine: Machine<S, M, C>,
	choices: readonly number[],
	target?: string,
	swarm = false,
): Walked {
	const laws = machine.laws();
	let watches: (Watch<S, M, C> | null)[] = laws.map((l) => l.begin());
	let at: At<S, M, C> = {state: machine.init, flight: [], echoes: []};
	const path: string[] = [];
	const mask = swarm ? (choices[0] ?? 0) : 0;
	for (const choice of swarm ? choices.slice(1) : choices) {
		const all = nextOf(machine.world, at);
		const on = mask === 0 ? all : all.filter((m) => (mask & bitOf(m.msg.type)) === 0);
		const moves = on.length > 0 ? on : all;
		const move = moves[choice % Math.max(moves.length, 1)];
		if (move === undefined) break;
		path.push(machine.show(move.msg));
		let result: readonly [S, readonly C[]];
		try {
			result = machine.update(at.state, move.msg);
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			return target === undefined || target === "update throws"
				? {broke: {law: "update throws", why}, path}
				: {broke: null, path};
		}
		const [state, cmds] = result;
		const step: Step<S, M, C> = {prev: at.state, msg: move.msg, next: state, cmds};
		let broke: Walked["broke"] = null;
		watches = watches.map((w, i) => {
			if (w === null) return null;
			const looked = w.step(step);
			if (!(looked instanceof Broke)) return looked;
			const law = laws[i]?.name ?? `law ${i}`;
			if (broke === null && (target === undefined || target === law))
				broke = {law, why: looked.why};
			return null;
		});
		if (broke !== null) return {broke, path};
		const echoes =
			machine.world.echoes === true && move.echo ? [...move.echoes, move.msg] : move.echoes;
		at = {state, flight: fly(move.flight, cmds), echoes};
	}
	return {broke: null, path};
}

// ---------------------------------------------------------------- a world of machines

/** Walk a world by the choices, each safety law after every step. Stops as `walk` does. */
export function walkWorld<W, N>(
	sys: System<W, N>,
	laws: readonly Safety<W, N>[],
	choices: readonly number[],
	target?: string,
): Walked {
	let w = sys.init;
	const path: string[] = [];
	for (const choice of choices) {
		const moves = sys.moves(w);
		const move = moves[choice % Math.max(moves.length, 1)];
		if (move === undefined) break;
		path.push(move.label);
		for (const law of laws) {
			if (target !== undefined && law.name !== target) continue;
			const why = law.check(w, move, move.next);
			if (why !== null) return {broke: {law: law.name, why}, path};
		}
		w = move.next;
	}
	return {broke: null, path};
}

/** The law name an "every lane ends" break is reported under. */
export const ENDS = "every lane ends";

/**
 * Walk a world for "every lane ends". The choices are used round and round
 * for up to `limit` steps; a rare move (a restart) only on the first time
 * round. It breaks on a dead state, or on a fair loop that keeps a lane open.
 * A lane's end need not last (`System.ended` may say "not waiting on a
 * child"), so the walk goes on past it.
 */
export function walkEnds<W, N>(
	sys: System<W, N>,
	choices: readonly number[],
	limit: number,
): Walked {
	if (choices.length === 0) return {broke: null, path: []};
	let w = sys.init;
	const path: string[] = [];
	/** Each state seen on this walk, by key: where it was first and last seen. */
	const seen = new Map<string, {readonly first: number; readonly last: number}>();
	/** For each state on the walk: the classes possible there, the lanes open, and the move taken. */
	const trail: {
		readonly classes: ReadonlySet<string>;
		readonly open: readonly number[];
		readonly took: string | null;
		readonly rare: boolean;
	}[] = [];
	const lanes = Array.from({length: sys.lanes}, (_, lane) => lane);
	/** A lane open in every state of the loop from step `from`, which every class owed is taken in. */
	const fairLoop = (from: number, classes: ReadonlySet<string>, open: readonly number[]) => {
		const loop = trail.slice(from);
		if (loop.some((t) => t.rare)) return null;
		const always = [...classes].filter((c) => loop.every((t) => t.classes.has(c)));
		const taken = new Set(loop.map((t) => t.took));
		if (!always.every((c) => taken.has(c))) return null;
		const lane = open.find((l) => loop.every((t) => t.open.includes(l)));
		return lane === undefined ? null : {lane, steps: loop.length};
	};
	for (let i = 0; i < limit; i++) {
		const open = lanes.filter((lane) => !sys.ended(w, lane));
		const all = sys.moves(w);
		const classes = new Set(all.flatMap((m) => (m.fair === null ? [] : [m.fair])));
		const first = open[0];
		if (first !== undefined && classes.size === 0)
			return {broke: {law: ENDS, why: `L${first + 1} is open and nothing must happen`}, path};
		if (all.length === 0) return {broke: null, path};
		const key = sys.key(w);
		const before = seen.get(key);
		if (before !== undefined && open.length > 0) {
			const loop = fairLoop(before.first, classes, open) ?? fairLoop(before.last, classes, open);
			if (loop !== null)
				return {
					broke: {
						law: ENDS,
						why: `L${loop.lane + 1} goes round a fair loop of ${loop.steps} step(s) for good`,
					},
					path,
				};
		}
		seen.set(key, {first: before?.first ?? i, last: i});
		const moves = i < choices.length ? all : all.filter((m) => !m.rare);
		const move = moves[(choices[i % choices.length] as number) % Math.max(moves.length, 1)];
		if (move === undefined) return {broke: null, path};
		trail.push({classes, open, took: move.fair, rare: move.rare});
		path.push(move.label);
		w = move.next;
	}
	return {broke: null, path};
}
