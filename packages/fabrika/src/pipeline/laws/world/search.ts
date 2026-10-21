// A search over a whole world: several machines, the parts they share, and
// what is in flight between them.
//
// `../explore.ts` walks one machine. This file walks a world that holds many:
// a state is every machine's state, the shared parts (main, the merge queue,
// the ledger) and the Cmds in flight. One step is any one thing that can
// happen next: a machine handles a Msg, a Cmd's answer comes back, or the
// outside world acts. The world says what can happen (`System.moves`); this
// file does not know what a lane or a ticket is.
//
// It searches breadth first, keeps a state only the first time it sees it,
// checks every safety law on every step, and prints the shortest sequence
// that breaks one. On top of that:
//
//   - partial-order reduction (`por`): from a state, when one lane's next
//     moves all touch only that lane's own parts and change nothing a law
//     across lanes reads, only that lane's moves are tried. Moves of other
//     lanes stay possible and are tried from the next state. The rule is
//     written out at `ample` below.
//   - symmetry (`symmetry`): two states that are the same up to renaming the
//     lanes are one state (`System.canon`).
//   - "eventually" laws (`eventually`), on the whole graph: a loop that never
//     reaches a lane's end, under weak fairness, is printed as a lasso (the
//     path to the loop, then the part that repeats); a state with nothing
//     left that must happen, before a lane's end, is printed as a dead state.
//
// Weak fairness: a move of a fairness class that stays possible from some
// point on happens in the end. A Cmd in flight is answered, a clock fires,
// CI reports. A move with no class (`fair: null`) may never happen: the
// owner may never answer, CI may run again or not. A rare move (a restart)
// happens only finitely often, so a loop through one does not count.

/** One thing that can happen next. */
export interface Move<W, N = unknown> {
	/** What happened, in a few words, for a printed sequence. */
	readonly label: string;
	/** The lane it belongs to, from 0. -1: the world's own (someone else merges to main). */
	readonly lane: number;
	/** The parts of the world it reads or writes. More than it touches is safe; fewer is not. */
	readonly touches: readonly string[];
	/** Its weak-fairness class. `null`: it may never happen. */
	readonly fair: string | null;
	/** A disturbance that happens only finitely often (a restart): no loop through it counts. */
	readonly rare: boolean;
	readonly next: W;
	/** What a law may need to know about the move beyond the two states. */
	readonly note?: N;
}

/** A world to search. */
export interface System<W, N = unknown> {
	readonly init: W;
	/** How many lanes the world has. */
	readonly lanes: number;
	/** Every move possible from a state. */
	readonly moves: (w: W) => readonly Move<W, N>[];
	/** A key per state: two states with one key are one state. */
	readonly key: (w: W) => string;
	/** The key up to renaming the lanes: the least key over every renaming. */
	readonly canon: (w: W) => string;
	/** Whether a part of the world is only ever touched by this lane's moves. */
	readonly mine: (lane: number, part: string) => boolean;
	/** What a law across lanes sees of one lane. A move that changes it is visible. */
	readonly face: (w: W, lane: number) => string;
	/** Whether a lane is at its end. */
	readonly ended: (w: W, lane: number) => boolean;
}

/** A safety law: one step, yes or no. `null`: it holds. */
export interface Safety<W, N = unknown> {
	readonly name: string;
	readonly check: (prev: W, move: Move<W, N>, next: W) => string | null;
}

export interface Options<W, N> {
	readonly laws: readonly Safety<W, N>[];
	/** The longest sequence tried. */
	readonly depth: number;
	/** Stop once this many states are kept. */
	readonly most?: number;
	readonly por?: boolean;
	readonly symmetry?: boolean;
	/**
	 * Keep the graph and check "every lane ends" on it. Needs the whole space
	 * (it says so when the bound cut it), and no reduction: both reductions
	 * here are for safety laws only.
	 */
	readonly eventually?: boolean;
}

/** A safety law broken, with the shortest sequence found. */
export interface Broken {
	readonly law: string;
	readonly why: string;
	readonly path: readonly string[];
}

/** A loop that never reaches a lane's end, under weak fairness. */
export interface Lasso {
	readonly lane: number;
	/** From the start to the loop. */
	readonly prefix: readonly string[];
	/** The part that repeats, ending where it began. */
	readonly cycle: readonly string[];
}

/** A state where nothing is left that must happen, and a lane has not ended. */
export interface Dead {
	readonly lane: number;
	readonly path: readonly string[];
}

export interface Report {
	readonly states: number;
	/** Steps taken, counting the ones that led to a state already kept. */
	readonly steps: number;
	/** New states found at each depth, from 0. */
	readonly layers: readonly number[];
	/** Nothing was left to explore before the bound. */
	readonly complete: boolean;
	readonly capped: boolean;
	readonly ms: number;
	/** The most moves possible from one state. */
	readonly widest: number;
	/** How many different moves, by label, were taken: the world's alphabet. */
	readonly alphabet: number;
	/** States where only one lane's moves were tried. */
	readonly reduced: number;
	readonly broken: readonly Broken[];
	/** `null`: the graph was not kept. */
	readonly lassos: readonly Lasso[] | null;
	readonly dead: readonly Dead[] | null;
}

/**
 * The moves to try from a state: one lane's, when that is enough, else all.
 *
 * The independence rule. Two moves of different lanes commute when neither
 * touches a part the other touches. A lane's move that touches only parts
 * that lane alone ever touches (`mine`) commutes with every move of every
 * other lane, now and later: no other lane can change what it reads, enable
 * it or disable it. So from a state where every possible move of lane L is
 * such a move, and none of them changes what a law across lanes reads of L
 * (`face`), trying only L's moves loses no state a law can tell apart: any
 * sequence that starts with another lane's moves reaches the same states with
 * L's moves taken first. This is the ample-set rule (C0 to C2 of Peled's
 * conditions). The cycle condition (C3) is checked in `search`: if a reduced
 * step leads to a state kept at the same depth or before, the state is
 * expanded in full. Every loop in a breadth-first walk has such a step, so no
 * lane's moves are put off forever around a loop.
 *
 * A law across lanes must read only `face` and moves that touch shared parts;
 * a law about one lane may read that lane's own parts. Those are the two
 * kinds the laws here are.
 */
function ample<W, N>(sys: System<W, N>, w: W, moves: readonly Move<W, N>[]): readonly Move<W, N>[] {
	for (let lane = 0; lane < sys.lanes; lane++) {
		const own = moves.filter((m) => m.lane === lane);
		if (own.length === 0 || own.length === moves.length) continue;
		const face = sys.face(w, lane);
		const local = own.every(
			(m) => m.touches.every((part) => sys.mine(lane, part)) && sys.face(m.next, lane) === face,
		);
		if (local) return own;
	}
	return moves;
}

/** A growable list of 32-bit numbers. */
class Ints {
	data = new Int32Array(1024);
	size = 0;
	push(n: number): void {
		if (this.size === this.data.length) {
			const bigger = new Int32Array(this.data.length * 2);
			bigger.set(this.data);
			this.data = bigger;
		}
		this.data[this.size++] = n;
	}
	at(i: number): number {
		return this.data[i] as number;
	}
}

/** Strings, each kept once, by number. */
class Names {
	readonly list: string[] = [];
	readonly ids = new Map<string, number>();
	id(name: string): number {
		const known = this.ids.get(name);
		if (known !== undefined) return known;
		this.list.push(name);
		this.ids.set(name, this.list.length - 1);
		return this.list.length - 1;
	}
}

/** Walk the world breadth first, check every law on every step, and report. Pure apart from the clock it reads for `ms`. */
export function search<W, N>(sys: System<W, N>, options: Options<W, N>): Report {
	const started = performance.now();
	const por = options.por ?? false;
	const symmetry = options.symmetry ?? false;
	const graph = options.eventually ?? false;
	if (graph && (por || symmetry))
		throw new Error("the eventually check needs the whole graph: no reduction");
	const most = options.most ?? Number.POSITIVE_INFINITY;
	const keyOf = symmetry ? sys.canon : sys.key;

	const labels = new Names();
	const fairs = new Names();
	const ids = new Map<string, number>([[keyOf(sys.init), 0]]);
	/** How each state was first reached: the state before it and the move's label. */
	const parent = new Ints();
	const via = new Ints();
	/** The depth each state was first found at. */
	const level = new Ints();
	parent.push(-1);
	via.push(-1);
	level.push(0);
	// The graph, for the eventually check: each state's edges in one run.
	const from = new Ints();
	const upto = new Ints();
	const to = new Ints();
	const label = new Ints();
	const fair = new Ints();
	const rare = new Ints();
	/** One bit per lane: ended. */
	const ends = new Ints();

	const pathTo = (id: number): string[] => {
		const path: string[] = [];
		for (let at = id; at > 0; at = parent.at(at)) path.push(labels.list[via.at(at)] as string);
		return path.reverse();
	};
	const endsOf = (w: W): number => {
		let bits = 0;
		for (let lane = 0; lane < sys.lanes; lane++) if (sys.ended(w, lane)) bits |= 1 << lane;
		return bits;
	};
	if (graph) ends.push(endsOf(sys.init));

	const broken = new Map<string, Broken>();
	const layers: number[] = [1];
	let frontier: {readonly id: number; readonly w: W}[] = [{id: 0, w: sys.init}];
	let steps = 0;
	let widest = 0;
	let reduced = 0;
	let capped = false;
	/** The states whose moves were all tried, for the graph. */
	let expanded = 0;

	for (let depth = 0; depth < options.depth && frontier.length > 0 && !capped; depth++) {
		const next: {readonly id: number; readonly w: W}[] = [];
		for (const {id, w} of frontier) {
			const all = sys.moves(w);
			widest = Math.max(widest, all.length);
			let moves = por ? ample(sys, w, all) : all;
			// C3, for a breadth-first walk: a reduced step that leads to a state kept at this
			// depth or before (not one found for the next depth) could close a loop; expand in full.
			if (
				moves !== all &&
				moves.some((m) => {
					const seen = ids.get(keyOf(m.next));
					return seen !== undefined && level.at(seen) <= depth;
				})
			)
				moves = all;
			if (moves !== all) reduced++;
			if (graph) from.push(to.size);
			for (const move of moves) {
				steps++;
				const labelId = labels.id(move.label);
				for (const law of options.laws) {
					if (broken.has(law.name)) continue;
					const why = law.check(w, move, move.next);
					if (why !== null)
						broken.set(law.name, {law: law.name, why, path: [...pathTo(id), move.label]});
				}
				const key = keyOf(move.next);
				let target = ids.get(key);
				if (target === undefined) {
					target = ids.size;
					ids.set(key, target);
					parent.push(id);
					via.push(labelId);
					level.push(depth + 1);
					if (graph) ends.push(endsOf(move.next));
					next.push({id: target, w: move.next});
					if (ids.size >= most) capped = true;
				}
				if (graph) {
					to.push(target);
					label.push(labelId);
					fair.push(move.fair === null ? -1 : fairs.id(move.fair));
					rare.push(move.rare ? 1 : 0);
				}
				if (capped) break;
			}
			if (graph) upto.push(to.size);
			expanded++;
			if (capped) break;
		}
		layers.push(next.length);
		frontier = next;
	}

	const complete = frontier.length === 0 && !capped;
	let lassos: Lasso[] | null = null;
	let dead: Dead[] | null = null;
	if (graph) {
		const g: Graph = {from, upto, to, label, fair, rare, ends, expanded, lanes: sys.lanes};
		lassos = [];
		dead = [];
		for (let lane = 0; lane < sys.lanes; lane++) {
			const found = lassoOf(g, lane, labels.list, pathTo);
			if (found !== null) lassos.push(found);
			const stuck = deadOf(g, lane);
			if (stuck !== null) dead.push({lane, path: pathTo(stuck)});
		}
	}

	return {
		states: ids.size,
		steps,
		layers,
		complete,
		capped,
		ms: Math.round(performance.now() - started),
		widest,
		alphabet: labels.list.length,
		reduced,
		broken: [...broken.values()],
		lassos,
		dead,
	};
}

interface Graph {
	readonly from: Ints;
	readonly upto: Ints;
	readonly to: Ints;
	readonly label: Ints;
	readonly fair: Ints;
	readonly rare: Ints;
	readonly ends: Ints;
	/** States 0 to `expanded - 1` had every move tried. */
	readonly expanded: number;
	readonly lanes: number;
}

/** The edges of one state, as indexes into the edge lists. */
function* edgesOf(g: Graph, id: number): Generator<number> {
	if (id >= g.expanded) return;
	for (let e = g.from.at(id); e < g.upto.at(id); e++) yield e;
}

const open = (g: Graph, id: number, lane: number) => (g.ends.at(id) & (1 << lane)) === 0;

/** The first state, by depth, where the lane has not ended and nothing that must happen is possible. */
function deadOf(g: Graph, lane: number): number | null {
	for (let id = 0; id < g.expanded; id++) {
		if (!open(g, id, lane)) continue;
		let must = false;
		for (const e of edgesOf(g, id))
			if (g.fair.at(e) >= 0) {
				must = true;
				break;
			}
		if (!must) return id;
	}
	return null;
}

/**
 * A fair loop where the lane never ends, or `null`. The states where the lane
 * has not ended, joined by moves that are not rare, are cut into strongly
 * connected parts (Tarjan). A part with a loop in it is fair when every
 * fairness class possible in all of its states is taken by some move inside
 * it: a walk through the whole part, round and round, then takes each such
 * class, and no class stays possible without being taken. If some class is
 * possible everywhere in the part and taken nowhere in it, no loop inside the
 * part is fair, since every loop there keeps it possible and never takes it.
 */
function lassoOf(
	g: Graph,
	lane: number,
	names: readonly string[],
	pathTo: (id: number) => string[],
): Lasso | null {
	const inside = (e: number, id: number) =>
		g.rare.at(e) === 0 && open(g, id, lane) && g.to.at(e) < g.expanded && open(g, g.to.at(e), lane);
	// Tarjan, without recursion.
	const n = g.expanded;
	const index = new Int32Array(n).fill(-1);
	const low = new Int32Array(n);
	const onStack = new Uint8Array(n);
	const part = new Int32Array(n).fill(-1);
	const stack: number[] = [];
	let counter = 0;
	let parts = 0;
	const fairParts: number[] = [];
	const members: number[][] = [];
	for (let root = 0; root < n; root++) {
		if (index[root] !== -1 || !open(g, root, lane)) continue;
		const work: {id: number; edges: number[]; at: number}[] = [];
		const enter = (id: number) => {
			index[id] = low[id] = counter++;
			stack.push(id);
			onStack[id] = 1;
			work.push({id, edges: [...edgesOf(g, id)].filter((e) => inside(e, id)), at: 0});
		};
		enter(root);
		while (work.length > 0) {
			const top = work[work.length - 1] as {id: number; edges: number[]; at: number};
			if (top.at < top.edges.length) {
				const w = g.to.at(top.edges[top.at++] as number);
				if (index[w] === -1) enter(w);
				else if (onStack[w] === 1)
					low[top.id] = Math.min(low[top.id] as number, index[w] as number);
				continue;
			}
			work.pop();
			const below = work[work.length - 1];
			if (below !== undefined)
				low[below.id] = Math.min(low[below.id] as number, low[top.id] as number);
			if (low[top.id] !== index[top.id]) continue;
			const ids: number[] = [];
			let x: number;
			do {
				x = stack.pop() as number;
				onStack[x] = 0;
				part[x] = parts;
				ids.push(x);
			} while (x !== top.id);
			members.push(ids);
			parts++;
		}
	}
	for (let p = 0; p < parts; p++) {
		const ids = members[p] as number[];
		const looped =
			ids.length > 1 ||
			[...edgesOf(g, ids[0] as number)].some(
				(e) => inside(e, ids[0] as number) && g.to.at(e) === ids[0],
			);
		if (!looped) continue;
		if (unfairIn(g, ids, part, p, lane) === null) fairParts.push(p);
	}
	if (fairParts.length === 0) return null;
	// The fair part reached first, by depth.
	let best = -1;
	let entry = n;
	for (const p of fairParts) {
		let first = n;
		for (const id of members[p] as number[]) if (id < first) first = id;
		if (first < entry) {
			entry = first;
			best = p;
		}
	}
	const cycle = fairWalk(g, members[best] as number[], part, best, entry, lane, names);
	return {lane, prefix: pathTo(entry), cycle};
}

/** The fairness classes possible in a state. */
function classesAt(g: Graph, id: number): Set<number> {
	const out = new Set<number>();
	for (const e of edgesOf(g, id)) if (g.fair.at(e) >= 0) out.add(g.fair.at(e));
	return out;
}

/** A class possible in every state of the part and taken by no move inside it, or `null`: the part is fair. */
function unfairIn(
	g: Graph,
	ids: readonly number[],
	part: Int32Array,
	p: number,
	lane: number,
): number | null {
	let always: Set<number> | null = null;
	const taken = new Set<number>();
	for (const id of ids) {
		const here = classesAt(g, id);
		const before: Set<number> | null = always;
		always = before === null ? here : new Set([...before].filter((c: number) => here.has(c)));
		for (const e of edgesOf(g, id))
			if (g.rare.at(e) === 0 && part[g.to.at(e)] === p && open(g, g.to.at(e), lane))
				taken.add(g.fair.at(e));
	}
	for (const c of always ?? []) if (!taken.has(c)) return c;
	return null;
}

/**
 * A loop inside one fair part, from `entry` back to it, that is fair on its
 * own: it takes every class possible in all the states it passes. It starts
 * as the shortest way round and adds a move of each class it is still unfair
 * to, or a visit to a state where that class is not possible, until none is
 * left.
 */
function fairWalk(
	g: Graph,
	ids: readonly number[],
	part: Int32Array,
	p: number,
	entry: number,
	lane: number,
	names: readonly string[],
): string[] {
	const within = (e: number) =>
		g.rare.at(e) === 0 && part[g.to.at(e)] === p && open(g, g.to.at(e), lane);
	/**
	 * The shortest way inside the part from `a` to a state `goal` says yes to,
	 * as edge indexes. `still`: `a` itself counts, with no move.
	 */
	const route = (a: number, goal: (id: number) => boolean, still: boolean): number[] => {
		if (still && goal(a)) return [];
		const back = new Map<number, {readonly edge: number; readonly from: number}>();
		let layer = [a];
		const seen = new Set<number>([a]);
		while (layer.length > 0) {
			const next: number[] = [];
			for (const id of layer)
				for (const e of edgesOf(g, id)) {
					if (!within(e)) continue;
					const t = g.to.at(e);
					if (goal(t)) {
						const path = [e];
						for (let at = id; at !== a; ) {
							const step = back.get(at);
							if (step === undefined) break;
							path.push(step.edge);
							at = step.from;
						}
						return path.reverse();
					}
					if (seen.has(t)) continue;
					seen.add(t);
					back.set(t, {edge: e, from: id});
					next.push(t);
				}
			layer = next;
		}
		return [];
	};
	const walk: number[] = [];
	let at = entry;
	const take = (edges: readonly number[]) => {
		walk.push(...edges);
		const last = edges[edges.length - 1];
		if (last !== undefined) at = g.to.at(last);
	};
	for (let guard = 0; guard < 64; guard++) {
		const always = classesAt(g, entry);
		for (const e of walk) {
			const here = classesAt(g, g.to.at(e));
			for (const c of always) if (!here.has(c)) always.delete(c);
		}
		const taken = new Set(walk.map((e) => g.fair.at(e)));
		const owed = [...always].find((c) => !taken.has(c));
		if (owed === undefined) break;
		// Take a move of the owed class inside the part; with none, visit a state where it is not possible.
		const has = (id: number) => [...edgesOf(g, id)].some((e) => within(e) && g.fair.at(e) === owed);
		if (ids.some(has)) {
			take(route(at, has, true));
			const e = [...edgesOf(g, at)].find((x) => within(x) && g.fair.at(x) === owed);
			if (e !== undefined) take([e]);
		} else take(route(at, (id) => !classesAt(g, id).has(owed), true));
	}
	take(route(at, (id) => id === entry, walk.length > 0));
	return walk.map((e) => names[g.label.at(e)] as string);
}
