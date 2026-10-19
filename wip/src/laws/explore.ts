import {applyCell, type Cmd, type Machine, structuralHash} from "@demlik/tea";

// Every order of messages, walked through a real reducer.
//
// A tea machine hears the world only as Msgs, and its `update` is a plain
// function. So "every order things can happen in" is "every Msg sequence",
// and the reducer can be called on each one. This file does that the way a
// model checker (TLC) does it, on our own code instead of a separate model:
//
//   - start from the machine's first state;
//   - from each state, try every Msg the world could send next;
//   - keep a state only the first time it is seen (a breadth-first search);
//   - check each law after every step;
//   - stop at a depth bound, and say whether anything was left unexplored.
//
// Breadth first means the first break found for a law is a shortest one: no
// shorter Msg sequence breaks it.
//
// The world is part of what is searched. A Cmd the machine sends goes into
// a bag of Cmds in flight, and the world may answer any of them, in any
// order, with any answer it can give. A restart empties the bag: Cmds in
// flight die with the process. Listens and clocks are sent at any time,
// whether or not the machine is listening, so a late or stray one is tried
// too. With `echoes` on, an answer may also come a second time, later.
//
// What it does not check: the code that answers a Cmd (the interpret
// handlers, GitHub), anything past the depth bound, and any value outside
// the small sets the world is given.

/** One step: the state before, the Msg, the state after, and the Cmds it sent. */
export interface Step<S, M, C> {
	readonly prev: S;
	readonly msg: M;
	readonly next: S;
	readonly cmds: readonly C[];
}

/** A law said no. `why` is in words, for the report. */
export class Broke {
	readonly why: string;
	constructor(why: string) {
		this.why = why;
	}
}
export const broke = (why: string): Broke => new Broke(why);

/**
 * One law, part way along one path. `key` names what it remembers, so two
 * paths that reach the same machine state with different memories are kept
 * apart.
 */
export interface Watch<S, M, C> {
	readonly key: string;
	readonly step: (step: Step<S, M, C>) => Watch<S, M, C> | Broke;
}

/** A law: a name, and how it starts watching a path. */
export interface Law<S, M, C> {
	readonly name: string;
	readonly begin: () => Watch<S, M, C>;
}

/** A law that looks at one step at a time and remembers nothing. `null`: it holds. */
export function law<S, M, C>(
	name: string,
	check: (step: Step<S, M, C>) => string | null,
): Law<S, M, C> {
	const watch: Watch<S, M, C> = {
		key: "",
		step: (step) => {
			const why = check(step);
			return why === null ? watch : broke(why);
		},
	};
	return {name, begin: () => watch};
}

/**
 * A law that remembers something along the path (the last facts read, the
 * heads asked for). Like a reducer: the memory before and one step in, the
 * memory after, or what broke. The memory must be plain data.
 */
export function watched<S, M, C, W>(
	name: string,
	start: W,
	step: (memory: W, step: Step<S, M, C>) => W | Broke,
): Law<S, M, C> {
	const at = (memory: W): Watch<S, M, C> => ({
		key: structuralHash(memory),
		step: (s) => {
			const after = step(memory, s);
			return after instanceof Broke ? after : at(after);
		},
	});
	return {name, begin: () => at(start)};
}

/**
 * A law across paths: two steps anywhere in the search that share a `key`
 * must give the same `value`. For "the builder's text never changes the
 * outcome": the same form on the same ticket ends the same way whatever the
 * builder wrote. Its memory is the whole search's, so make the law fresh for
 * each search. `null`: the step says nothing.
 */
export function agree<S, M, C>(
	name: string,
	read: (step: Step<S, M, C>) => {
		readonly key: string;
		readonly value: string;
		readonly seen: string;
	} | null,
): Law<S, M, C> {
	const first = new Map<string, {readonly value: string; readonly seen: string}>();
	const watch: Watch<S, M, C> = {
		key: "",
		step: (step) => {
			const got = read(step);
			if (got === null) return watch;
			const before = first.get(got.key);
			if (before === undefined) {
				first.set(got.key, {value: got.value, seen: got.seen});
				return watch;
			}
			return before.value === got.value
				? watch
				: broke(`${got.seen} ended ${got.value}; ${before.seen} ended ${before.value}`);
		},
	};
	return {name, begin: () => watch};
}

/** What the world may do. */
export interface World<S, M, C> {
	/** Msgs that may come at any time from outside: a start, a Listen, a clock, a restart. */
	readonly outside: (state: S) => readonly M[];
	/** Every answer one Cmd may get. */
	readonly answers: (cmd: C) => readonly M[];
	/** A Msg that only comes after a restart: every Cmd in flight died with the process. */
	readonly restart?: (msg: M) => boolean;
	/** An answer may come a second time, later. Off: each Cmd is answered once. */
	readonly echoes?: boolean;
}

/** Every Msg a machine takes: its own, and the answer to each of its Cmds. */
export type MsgOf<T> =
	T extends Machine<infer _S, infer M, infer _C, infer _U, infer _X> ? M : never;

/** One reducer step: `applyCell` on the real machine, or a planted mistake around it. */
export type Update<S, M, C> = (state: S, msg: M) => readonly [S, readonly C[]];

/** The real machine's own step: the same dispatch `run` and `replay` use. */
export const stepOf =
	<S, M extends {readonly type: string}, C extends Cmd>(machine: {
		readonly update: object;
	}): Update<S, M, C> =>
	(state, msg) =>
		applyCell<S, M, C>(machine, state, msg);

export interface Search<S, M, C> {
	readonly init: S;
	readonly update: Update<S, M, C>;
	readonly world: World<S, M, C>;
	readonly laws: readonly Law<S, M, C>[];
	/** The longest Msg sequence tried. */
	readonly depth: number;
	/** Stop once this many states are kept. The report says it stopped. */
	readonly most?: number;
}

/** The shortest Msg sequence found that breaks one law. */
export interface Found<M> {
	readonly law: string;
	readonly why: string;
	readonly path: readonly M[];
}

export interface Report<M> {
	/** Distinct states kept: the machine's state, the Cmds in flight, and each law's memory. */
	readonly states: number;
	/**
	 * Every Msg type the search sent at least once, sorted. Set against the
	 * machine's whole alphabet, it shows a law that held only because the Msg
	 * that would break it was never sent.
	 */
	readonly sent: readonly string[];
	/** Steps taken, counting the ones that led to a state already kept. */
	readonly steps: number;
	/** New states found at each depth, from 0. */
	readonly layers: readonly number[];
	/** Nothing was left to explore: every reachable state was seen before the bound. */
	readonly complete: boolean;
	/** The search stopped at `most` states. */
	readonly capped: boolean;
	readonly ms: number;
	/** The most Msgs tried from one state: the alphabet as the machine meets it. */
	readonly widest: number;
	/** The first break of each law, in the order found. A law not here held to the bound. */
	readonly broken: readonly Found<M>[];
}

/** A law that has broken on this path is not asked again on it. */
const DEAD = "x";

interface Flight<C> {
	readonly key: string;
	readonly cmd: C;
}

interface Node<S, M, C> {
	readonly state: S;
	readonly flight: readonly Flight<C>[];
	readonly echoes: readonly M[];
	readonly watches: readonly (Watch<S, M, C> | null)[];
	readonly key: string;
}

const keyOf = <S, M, C>(
	state: S,
	flight: readonly Flight<C>[],
	echoes: readonly M[],
	watches: readonly (Watch<S, M, C> | null)[],
): string =>
	structuralHash({
		s: state,
		f: flight.map((f) => f.key),
		e: echoes.map((e) => structuralHash(e)).sort(),
		w: watches.map((w) => (w === null ? DEAD : w.key)),
	});

const describe = (error: unknown): string =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** One thing the world may do next: the Msg, and the bag of Cmds and echoes as they stand once it is taken. */
interface Move<M, C> {
	readonly msg: M;
	readonly flight: readonly Flight<C>[];
	readonly echoes: readonly M[];
	/** It answers a Cmd, so with echoes on it may come again. */
	readonly echo: boolean;
}

/** Every move the world may make from one node. */
function movesFrom<S, M, C>(world: World<S, M, C>, node: Node<S, M, C>): readonly Move<M, C>[] {
	const moves: Move<M, C>[] = [];
	for (const msg of world.outside(node.state)) {
		const restart = world.restart?.(msg) ?? false;
		moves.push({
			msg,
			flight: restart ? [] : node.flight,
			echoes: restart ? [] : node.echoes,
			echo: false,
		});
	}
	node.flight.forEach((f, at) => {
		if (at > 0 && node.flight[at - 1]?.key === f.key) return; // the same Cmd twice: one set of answers
		const rest = [...node.flight.slice(0, at), ...node.flight.slice(at + 1)];
		for (const msg of world.answers(f.cmd))
			moves.push({msg, flight: rest, echoes: node.echoes, echo: true});
	});
	node.echoes.forEach((msg, at) => {
		const rest = [...node.echoes.slice(0, at), ...node.echoes.slice(at + 1)];
		moves.push({msg, flight: node.flight, echoes: rest, echo: false});
	});
	return moves;
}

const addFlight = <C>(flight: readonly Flight<C>[], cmds: readonly C[]): readonly Flight<C>[] =>
	cmds.length === 0
		? flight
		: [...flight, ...cmds.map((cmd) => ({key: structuralHash(cmd), cmd}))].sort((a, b) =>
				a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
			);

/** What one move did: the node it led to, and each law that broke on it. `null` node: the reducer threw. */
interface Taken<S, M, C> {
	readonly node: Node<S, M, C> | null;
	readonly broke: readonly {readonly law: string; readonly why: string}[];
}

/** Take one move: the reducer, then every law still watching. */
function take<S, M, C>(
	search: Pick<Search<S, M, C>, "update" | "world" | "laws">,
	node: Node<S, M, C>,
	move: Move<M, C>,
): Taken<S, M, C> {
	let result: readonly [S, readonly C[]];
	try {
		result = search.update(node.state, move.msg);
	} catch (error) {
		return {node: null, broke: [{law: "update throws", why: describe(error)}]};
	}
	const [state, cmds] = result;
	const step: Step<S, M, C> = {prev: node.state, msg: move.msg, next: state, cmds};
	const broke: {law: string; why: string}[] = [];
	const watches = node.watches.map((watch, at) => {
		if (watch === null) return null;
		const looked = watch.step(step);
		if (!(looked instanceof Broke)) return looked;
		broke.push({law: search.laws[at]?.name ?? `law ${at}`, why: looked.why});
		return null;
	});
	const flight = addFlight(move.flight, cmds);
	const echoes =
		search.world.echoes === true && move.echo ? [...move.echoes, move.msg] : move.echoes;
	return {
		node: {state, flight, echoes, watches, key: keyOf(state, flight, echoes, watches)},
		broke,
	};
}

const startOf = <S, M, C>(search: Pick<Search<S, M, C>, "init" | "laws">): Node<S, M, C> => {
	const watches = search.laws.map((l) => l.begin());
	return {
		state: search.init,
		flight: [],
		echoes: [],
		watches,
		key: keyOf(search.init, [], [], watches),
	};
};

/** Where one followed path ended: the last state, every law it broke on the way, and the Msgs taken. */
export interface Followed<S, M> {
	readonly state: S;
	readonly broken: readonly Found<M>[];
	readonly path: readonly M[];
}

/**
 * Walk one path, given as the lines `show` prints for it (a breaking
 * sequence as `pathText` prints it, without the numbers). At each step the
 * world's moves are tried in order and the first whose line matches is
 * taken, so a regression test reads exactly like the finding it pins.
 * Throws when a line names no move the world can make there.
 */
export function follow<S, M, C>(
	search: Pick<Search<S, M, C>, "init" | "update" | "world" | "laws">,
	show: (msg: M) => string,
	lines: readonly string[],
): Followed<S, M> {
	let node = startOf(search);
	const path: M[] = [];
	const broken: Found<M>[] = [];
	for (const line of lines) {
		const moves = movesFrom(search.world, node);
		const move = moves.find((m) => show(m.msg) === line);
		if (move === undefined)
			throw new Error(
				`no move "${line}" after ${path.length} step(s); the world offers: ${[...new Set(moves.map((m) => show(m.msg)))].join(" | ")}`,
			);
		path.push(move.msg);
		const taken = take(search, node, move);
		for (const b of taken.broke)
			if (!broken.some((x) => x.law === b.law)) broken.push({...b, path: [...path]});
		if (taken.node === null) break;
		node = taken.node;
	}
	return {state: node.state, broken, path};
}

/** Walk every Msg sequence up to the bound, breadth first. Pure apart from the clock it reads for `ms`. */
export function explore<S, M extends {readonly type: string}, C>(
	search: Search<S, M, C>,
): Report<M> {
	const started = performance.now();
	const most = search.most ?? Number.POSITIVE_INFINITY;
	const first = startOf(search);
	const sent = new Set<string>();
	/** How each kept state was first reached: the state before it and the Msg. */
	const from = new Map<string, {readonly before: string | null; readonly msg: M | null}>([
		[first.key, {before: null, msg: null}],
	]);
	const pathTo = (key: string, last: M): M[] => {
		const path: M[] = [last];
		let at = from.get(key);
		while (at !== undefined && at.msg !== null && at.before !== null) {
			path.push(at.msg);
			at = from.get(at.before);
		}
		return path.reverse();
	};

	const broken = new Map<string, Found<M>>();
	const layers: number[] = [1];
	let frontier: Node<S, M, C>[] = [first];
	let steps = 0;
	let capped = false;
	let widest = 0;

	for (let depth = 0; depth < search.depth && frontier.length > 0 && !capped; depth++) {
		const next: Node<S, M, C>[] = [];
		for (const node of frontier) {
			const moves = movesFrom(search.world, node);
			widest = Math.max(widest, moves.length);
			for (const move of moves) {
				steps++;
				sent.add(move.msg.type);
				const taken = take(search, node, move);
				for (const b of taken.broke)
					if (!broken.has(b.law)) broken.set(b.law, {...b, path: pathTo(node.key, move.msg)});
				const after = taken.node;
				if (after === null || from.has(after.key)) continue;
				from.set(after.key, {before: node.key, msg: move.msg});
				next.push(after);
				if (from.size >= most) {
					capped = true;
					break;
				}
			}
			if (capped) break;
		}
		layers.push(next.length);
		frontier = next;
	}

	return {
		states: from.size,
		sent: [...sent].sort(),
		steps,
		layers,
		complete: frontier.length === 0 && !capped,
		capped,
		widest,
		ms: Math.round(performance.now() - started),
		broken: [...broken.values()],
	};
}

/** A Msg sequence as one short line per Msg, for a report. `show` picks what to print of each. */
export const pathText = <M>(path: readonly M[], show: (msg: M) => string): string =>
	path.map((msg, at) => `${at + 1}. ${show(msg)}`).join("\n");
