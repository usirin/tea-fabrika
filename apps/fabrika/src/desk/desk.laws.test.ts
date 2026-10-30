import {applyCell} from "@demlik/tea";
import {
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	activeOf,
	close,
	type Desk,
	type DeskCmd,
	deskMachine,
	empty,
	end,
	focusedOf,
	fresh,
	kill,
	type Open,
	open,
	restore,
	type Saved,
	save,
	savedOf,
	send,
	show,
	stop,
	takenNow,
	tilesOf,
	whereIs,
} from "./desk.ts";
import {checkTree, findTile, quiet, tiles, unfold} from "./layout/index.ts";

// The desk's laws, on tea's pbt: after every step of any list of Msgs, from the real init. Keys,
// clicks and drags come in any order, and so does what the tiles say (a run covers a tile, a run
// ends, a tile's jobs, a tile's tsh ended), for tiles that exist and tiles that do not. The
// "something good" laws press keys from wherever a list left the desk.

type Machine = typeof deskMachine;
type Msg = MsgOf<Machine>;
type DeskStep = Step<Desk, Msg, DeskCmd>;

const tile = fc.constantFrom("t1", "t2", "t3", "t4", "t5", "t6");
const run = fc.constantFrom(
	{id: "counter:1", program: "counter"},
	{id: "tracker:1", program: "tracker"},
	{id: "ticket:1", program: "ticket"},
	{id: "runs:1", program: "runs"},
);
/** A line's runs with a view: mostly one, sometimes two or three, each run once. */
const line = fc
	.uniqueArray(run, {minLength: 1, maxLength: 3, selector: (r) => r.id})
	.map((runs) => {
		const [first, ...rest] = runs;
		if (first === undefined) throw new Error("a line has a run");
		return [first, ...rest] as const;
	});
/** Half the keys are the prefix, so most lists split, zoom, close and walk a good deal. */
const after = ["|", "-", "h", "j", "k", "l", "<arrowup>", "z", "x", "N", "<c-h>", "<c-l>"];
/**
 * The turn and fold keys come less often, so they do not crowd out the questions and the closes;
 * x and y come a little more, so a question is asked and answered yes in most runs.
 */
const key = fc.oneof(
	{arbitrary: fc.constant("<c-b>"), weight: 4},
	{arbitrary: fc.constantFrom(...after, "y", "n", "<c-c>", "a"), weight: 3},
	{arbitrary: fc.constantFrom(" ", "f", "x", "y"), weight: 1},
);
/** A strip's node: a tile, or a container, that exists or not. */
const node = fc.constantFrom("t1", "t2", "t3", "t4", "c1", "c2", "c3", "c4", "c5");

/** A Cmd's failed answer. The desk's Cmds declare no errors, so a malformed answer is the one left. */
const failed = <T extends string, C>(type: T, cmd: C) =>
	fc.constant({type, cmd, error: {_tag: "malformed_result", issues: []} as const, at: 0});

const [opening, closing, stopping, sending, saving, emptying, ending, killing, showing] = [
	open({tile: "t1"}),
	close({tile: "t1"}),
	stop({tile: "t1"}),
	send({tile: "t1", data: "x"}),
	save({desk: savedOf(fresh())}),
	empty({}),
	end({process: "ticket:1"}),
	kill({process: "ticket:1"}),
	show({what: "asks"}),
] as const;

/** One entry per Msg type, the Cmds' answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	key: arbRecordMsg("key", {key, at: fc.nat({max: 3000})}),
	click: arbRecordMsg("click", {tile}),
	resize: arbRecordMsg("resize", {
		container: fc.constantFrom("c1", "c2", "c3", "c4"),
		sizes: fc.dictionary(tile, fc.double({min: 0, max: 200, noNaN: true})),
	}),
	fold: arbRecordMsg("fold", {tile}),
	unfold: arbRecordMsg("unfold", {node}),
	covered: arbRecordMsg("covered", {tile, runs: line}),
	area: arbRecordMsg("area", {
		width: fc.integer({min: 0, max: 3000}),
		height: fc.integer({min: 0, max: 2000}),
	}),
	over: arbRecordMsg("over", {run: run.map((r) => r.id)}),
	jobs: arbRecordMsg("jobs", {tile, running: fc.nat({max: 2})}),
	closing: arbRecordMsg("closing", {tile}),
	ended: arbRecordMsg("ended", {tile}),
	go: arbRecordMsg("go", {tile}),
	pick: arbRecordMsg("pick", {workspace: fc.constantFrom("w1", "w2", "w3", "w9")}),
	run: arbRecordMsg("run", {key: fc.constantFrom(...after, "1", "2", "a", "?", "q")}),
	show_ok: fc.constant(show.ok(showing, null, 0)),
	show_err: failed(show.errType, showing),
	open_ok: fc.constant(open.ok(opening, null, 0)),
	open_err: failed(open.errType, opening),
	close_ok: fc.constant(close.ok(closing, null, 0)),
	close_err: failed(close.errType, closing),
	stop_ok: fc.constant(stop.ok(stopping, null, 0)),
	stop_err: failed(stop.errType, stopping),
	send_ok: fc.constant(send.ok(sending, null, 0)),
	send_err: failed(send.errType, sending),
	save_ok: fc.constant(save.ok(saving, null, 0)),
	save_err: failed(save.errType, saving),
	empty_ok: fc.constant(empty.ok(emptying, null, 0)),
	empty_err: failed(empty.errType, emptying),
	end_ok: fc.constant(end.ok(ending, null, 0)),
	end_err: failed(end.errType, ending),
	kill_ok: fc.constant(kill.ok(killing, null, 0)),
	kill_err: failed(kill.errType, killing),
};
/**
 * Lists of Msgs, mostly keys. Not tea's `arbMsgSequence`: at fast-check's default size its lists
 * come out about ten long (demlik#744), too short to make a few workspaces and close them again.
 */
const random = fc.array(
	arbMsg(table, {weights: {key: 24, click: 2, covered: 3, over: 2, jobs: 2, closing: 1, area: 1}}),
	{maxLength: 60, size: "max"},
);
/**
 * A line of three typed in t1, its window t2 focused and asked to close, then answered y once or
 * twice. Random keys seldom get that far, and a window's close is a rule of its own.
 */
const asked: readonly Msg[] = [
	{
		type: "covered",
		tile: "t1",
		runs: [
			{id: "tracker:1", program: "tracker"},
			{id: "ticket:1", program: "ticket"},
			{id: "runs:1", program: "runs"},
		],
	},
	{type: "click", tile: "t2"},
	{type: "key", key: "<c-b>", at: 0},
	{type: "key", key: "x", at: 0},
];
const yes: Msg = {type: "key", key: "y", at: 0};
const windowFirst = fc.constantFrom<readonly Msg[]>(
	[],
	[],
	[...asked, yes],
	[...asked, yes, ...asked.slice(1), yes],
);
const lists = fc
	.tuple(windowFirst, random)
	.map(([first, rest]): readonly Msg[] => [...first, ...rest]);
const OPTS = {numRuns: 400, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const everyStep = (name: string, holds: (step: DeskStep) => boolean): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, holds, OPTS),
});

/** A law of where a list left the desk. */
const atTheEnd = (name: string, holds: (machine: Machine, last: Desk) => boolean): Law => ({
	name,
	check: (machine) => propertyTrace(machine, ctx, lists, (_, last) => holds(machine, last), OPTS),
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const tileIds = (s: Desk): ReadonlySet<string> =>
	new Set(s.at === "over" ? [] : s.workspaces.flatMap((ws) => tilesOf(ws).map((t) => t.id)));
const sameSet = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((x) => b.includes(x));
const tilesIn = (cmds: readonly DeskCmd[], type: "open" | "stop" | "close") =>
	cmds.flatMap((c) => (c.type === type ? [c.tile] : []));

/**
 * The desk as it is kept, with what runs in each tile left out: a kept desk shows no run, and a
 * line's other windows are gone. Focus on one of them goes to the first tile, open.
 */
const kept = (s: Open): Saved => ({
	...savedOf(s),
	workspaces: s.workspaces.map((ws) => {
		const layout = quiet(ws.layout);
		if (findTile(ws.layout, ws.focused)?.shows.kind !== "window") return {...ws, layout};
		const focused = [...tiles(layout.root)][0]?.id ?? ws.focused;
		return {...ws, layout: unfold(layout, focused), focused};
	}),
});

/** Press keys a moment apart, long after any list's keys: the repeat window is over by then. */
const LATE = 1_000_000;
const press = (machine: Machine, from: Desk, keys: readonly string[]) => {
	let s = from;
	const cmds: DeskCmd[] = [];
	for (const [at, key] of keys.entries()) {
		const [next, out] = applyCell<Desk, Msg, DeskCmd>(machine, s, {
			type: "key",
			key,
			at: LATE + at,
		});
		s = next;
		cmds.push(...out);
	}
	return {s, cmds};
};

// ---------------------------------------------------------------- never wrong

const whole = everyStep(
	"every layout stays whole: each tile in one place, focus on a tile there, the zoom on the focused tile, and the active workspace is one of them",
	({next: s}) => {
		if (s.at === "over") return true;
		const seen = new Set<string>();
		for (const ws of s.workspaces) {
			if (checkTree(ws.layout).length > 0 || findTile(ws.layout, ws.focused) === null) return false;
			if (ws.layout.zoomed !== null && ws.layout.zoomed !== ws.focused) return false;
			for (const t of tilesOf(ws)) {
				if (seen.has(t.id)) return false;
				seen.add(t.id);
			}
		}
		return s.workspaces.some((ws) => ws.id === s.active);
	},
);

const focusOpen = everyStep(
	"the focused tile is always open, never folded into a strip",
	({next: s}) =>
		s.at === "over" ||
		s.workspaces.every((ws) => findTile(ws.layout, ws.focused)?.folded === false),
);

const booksTidy = everyStep(
	"it asks only in a tile of the active workspace, counts jobs and closes only tiles that exist, and closes none twice",
	({next: s}) =>
		s.at === "over" ||
		((s.ask === null || findTile(activeOf(s).layout, s.ask) !== null) &&
			Object.keys(s.running).every((t) => whereIs(s, t) !== undefined) &&
			s.closing.every((t) => whereIs(s, t) !== undefined) &&
			new Set(s.closing).size === s.closing.length),
);

const opensAndStops = everyStep(
	"it opens a tsh for every tile it makes but a line's window, and stops every tile that goes, and no other",
	({prev, next, cmds}) => {
		const before = tileIds(prev);
		const now = tileIds(next);
		const windows = new Set(
			next.at === "open"
				? next.workspaces.flatMap((ws) =>
						tilesOf(ws).flatMap((t) => (t.shows.kind === "window" ? [t.id] : [])),
					)
				: [],
		);
		const made = [...now].filter((t) => !before.has(t) && !windows.has(t));
		const gone = [...before].filter((t) => !now.has(t));
		return sameSet(tilesIn(cmds, "open"), made) && sameSet(tilesIn(cmds, "stop"), gone);
	},
);

const closesOnce = everyStep(
	"it asks to close a tile only as the tile starts closing, and never one that is gone",
	({prev, next, cmds}) => {
		const was = prev.at === "open" ? prev.closing : [];
		const now = next.at === "open" ? next.closing : [];
		return tilesIn(cmds, "close").every((t) => now.includes(t) && !was.includes(t));
	},
);

const freshIds = everyStep(
	"an id is never given twice: every tile, container and workspace number is below the next one, which never goes down",
	({prev, next}) => {
		if (next.at === "over") return true;
		if (prev.at === "open" && next.next < prev.next) return false;
		const numbers = next.workspaces.flatMap((ws) => [
			ws.id,
			...[...tiles(ws.layout.root)].map((t) => t.id),
		]);
		return numbers.every((id) => Number(id.slice(1)) < next.next);
	},
);

const savesChanges = everyStep(
	"every change to what is kept is saved, and a save holds the desk as it is now",
	({prev, next, cmds}) => {
		const saves = cmds.flatMap((c) => (c.type === "save" ? [c.desk] : []));
		if (next.at === "over") return saves.length === 0;
		const changed = prev.at === "open" && !same(kept(prev), kept(next));
		return (!changed || saves.length > 0) && saves.every((d) => same(d, savedOf(next)));
	},
);

const takesWhatItSays = everyStep(
	"a key changes the desk or asks for work only when the desk said it takes that key",
	({prev, msg, next, cmds}) => {
		if (msg.type !== "key" || (same(prev, next) && cmds.length === 0)) return true;
		const takes = takenNow(prev, msg.at);
		return takes.all || takes.keys.includes(msg.key);
	},
);

const overStays = everyStep(
	"once the desk is over, it stays over and asks for nothing",
	({prev, next, cmds}) => prev.at !== "over" || (next.at === "over" && cmds.length === 0),
);

const emptiesAtTheEnd = everyStep(
	"the window is asked to close exactly when the last tile goes",
	({prev, next, cmds}) =>
		cmds.some((c) => c.type === "empty") === (prev.at === "open" && next.at === "over"),
);

// ---------------------------------------------------------------- something good

const yesCloses = everyStep(
	"y to a tile's question closes it: an idle or closing tile goes, stopped; a busy one starts closing; a line's window ends its one process, then kills it",
	({prev, msg, next, cmds}) => {
		if (prev.at !== "open" || prev.ask === null || msg.type !== "key" || msg.key !== "y")
			return true;
		const asked = prev.ask;
		const gone = !tileIds(next).has(asked) && tilesIn(cmds, "stop").includes(asked);
		const closing = next.at === "open" && next.closing.includes(asked);
		const shows = findTile(activeOf(prev).layout, asked)?.shows;
		if (shows?.kind === "window") {
			// Its tsh is the tile it was typed in: that tile is never closed for it.
			const only = (type: "end" | "kill") =>
				cmds.some((c) => c.type === type && c.process === shows.run.id) &&
				!tilesIn(cmds, "close").includes(shows.line.from);
			return prev.closing.includes(asked) ? gone && only("kill") : closing && only("end");
		}
		return gone || (closing && tilesIn(cmds, "close").includes(asked));
	},
);

const endedGoes = everyStep(
	"a tile whose tsh ended leaves the desk, stopped",
	({prev, msg, next, cmds}) =>
		msg.type !== "ended" ||
		!tileIds(prev).has(msg.tile) ||
		(!tileIds(next).has(msg.tile) && tilesIn(cmds, "stop").includes(msg.tile)),
);

const ctrlCReaches = everyStep(
	"Ctrl-C over a program in the focused tile goes at once to the tsh it runs in: the tile's, or the one its line was typed in",
	({prev, msg, cmds}) => {
		if (prev.at !== "open" || prev.ask !== null || prev.prefix.armed) return true;
		const focused = focusedOf(prev);
		if (msg.type !== "key" || msg.key !== "<c-c>" || focused?.shows.run == null) return true;
		const to = focused.shows.kind === "window" ? focused.shows.line.from : focused.id;
		return same(cmds, [send({tile: to, data: "\x03"})]);
	},
);

const splitOpens = atTheEnd(
	"wherever it is, Ctrl-B then | makes a new tile beside the focused one, focuses it, and opens its tsh",
	(machine, last) => {
		if (last.at === "over") return true;
		// `n` first: it answers a question no, ends a waiting prefix, and is nothing to the desk else.
		const {s, cmds} = press(machine, last, ["n", "<c-b>", "|"]);
		if (s.at === "over") return false;
		const made = activeOf(s).focused;
		return !tileIds(last).has(made) && same(tilesIn(cmds, "open"), [made]);
	},
);

const comesBack = atTheEnd(
	"a kept desk comes back as it was kept, and every tile's tsh is opened again",
	(machine, last) => {
		if (last.at === "over") return true;
		const back = restore(JSON.parse(JSON.stringify(savedOf(last))));
		if (back === null) return false;
		const [s, cmds] = machine.init(back, undefined);
		const all = back.workspaces.flatMap((ws) => tilesOf(ws).map((t) => open({tile: t.id})));
		return s.at === "open" && same(savedOf(s), kept(last)) && same(cmds, all);
	},
);

const LAWS = [
	whole,
	focusOpen,
	booksTidy,
	opensAndStops,
	closesOnce,
	freshIds,
	savesChanges,
	takesWhatItSays,
	overStays,
	emptiesAtTheEnd,
	yesCloses,
	endedGoes,
	ctrlCReaches,
	splitOpens,
	comesBack,
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

const real = deskMachine.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...deskMachine,
	update: {...real, ...update},
});
/** The desk with focus put on this tile, in the active workspace. */
const focusOn = (s: Open, focused: string): Open => {
	const [first, ...rest] = s.workspaces.map((ws) =>
		ws.id === activeOf(s).id ? {...ws, focused} : ws,
	);
	return first === undefined ? s : {...s, workspaces: [first, ...rest]};
};

const PLANTS = {
	/** A tile whose tsh ended goes, and focus stays where it was. */
	focusOnTheGone: plant({
		ended: (s, m) => {
			const [next, cmds] = real.ended(s, m);
			if (s.at !== "open" || next.at !== "open") return [next, cmds];
			return [focusOn(next, activeOf(s).focused), cmds];
		},
	}),
	/** A tile goes, and its jobs are still counted. */
	countsTheGone: plant({
		ended: (s, m) => {
			const [next, cmds] = real.ended(s, m);
			if (s.at !== "open" || next.at !== "open" || s.running[m.tile] === undefined)
				return [next, cmds];
			return [{...next, running: {...next.running, [m.tile]: s.running[m.tile] ?? 0}}, cmds];
		},
	}),
	/** A new tile is made and its tsh never opened. */
	forgetsToOpen: plant({
		key: (s, m) => {
			const [next, cmds] = real.key(s, m);
			return [next, cmds.filter((c) => c.type !== "open")];
		},
	}),
	/** Told a closing tile's jobs, it asks to close it again. */
	closesTwice: plant({
		jobs: (s, m) => {
			const [next, cmds] = real.jobs(s, m);
			return s.at === "open" && s.closing.includes(m.tile)
				? [next, [...cmds, close({tile: m.tile})]]
				: [next, cmds];
		},
	}),
	/** A split does not move the next number on. */
	mintsTwice: plant({
		key: (s, m) => {
			const [next, cmds] = real.key(s, m);
			return s.at === "open" && next.at === "open" ? [{...next, next: s.next}, cmds] : [next, cmds];
		},
	}),
	/** A dragged border is not saved. */
	quietResize: plant({
		resize: (s, m) => {
			const [next, cmds] = real.resize(s, m);
			return [next, cmds.filter((c) => c.type !== "save")];
		},
	}),
	/** `a` arms the prefix, though the desk never said it takes `a`. */
	grabsA: plant({
		key: (s, m) =>
			s.at === "open" && m.key === "a" && !s.prefix.armed && s.ask === null
				? [{...s, prefix: {armed: true, until: null}}, []]
				: real.key(s, m),
	}),
	/** Over, a key starts a fresh desk. */
	wakesUp: plant({
		key: (s, m) => (s.at === "over" ? [fresh(), [open({tile: "t1"})]] : real.key(s, m)),
	}),
	/** The last tile goes and the window is not told to close. */
	closesSilently: plant({
		ended: (s, m) => {
			const [next, cmds] = real.ended(s, m);
			return [next, cmds.filter((c) => c.type !== "empty")];
		},
	}),
	/** y is taken for no. */
	yesIsNo: plant({
		key: (s, m) =>
			s.at === "open" && s.ask !== null && m.key === "y" ? [{...s, ask: null}, []] : real.key(s, m),
	}),
	/** y to one window of a line closes the whole line: the tile it was typed in too. */
	closesTheLine: plant({
		key: (s, m) => {
			const [next, cmds] = real.key(s, m);
			if (s.at !== "open" || s.ask === null || m.key !== "y") return [next, cmds];
			const shows = findTile(activeOf(s).layout, s.ask)?.shows;
			if (shows?.kind !== "window") return [next, cmds];
			return [next, [...cmds, close({tile: shows.line.from})]];
		},
	}),
	/** A tile whose tsh ended stays. */
	deafToEnded: plant({ended: (s) => [s, []]}),
	/** Ctrl-C over a program is swallowed. */
	swallowsCtrlC: plant({
		key: (s, m) => {
			const [next, cmds] = real.key(s, m);
			return m.key === "<c-c>" ? [next, cmds.filter((c) => c.type !== "send")] : [next, cmds];
		},
	}),
	/** A split makes the new tile and leaves focus where it was. */
	splitKeepsFocus: plant({
		key: (s, m) => {
			const [next, cmds] = real.key(s, m);
			if (s.at !== "open" || next.at !== "open" || !cmds.some((c) => c.type === "open"))
				return [next, cmds];
			if (findTile(activeOf(next).layout, activeOf(s).focused) === null) return [next, cmds];
			const back = focusOn(next, activeOf(s).focused);
			return [back, cmds.map((c) => (c.type === "save" ? save({desk: savedOf(back)}) : c))];
		},
	}),
	/** `f` folds the focused tile and leaves focus on its strip. */
	foldsUnderFocus: plant({
		key: (s, m) => {
			const [next, cmds] = real.key(s, m);
			if (s.at !== "open" || next.at !== "open" || m.key !== "f") return [next, cmds];
			const [was, now] = [activeOf(s), activeOf(next)];
			if (was.id !== now.id || was.focused === now.focused) return [next, cmds];
			const back = focusOn(next, was.focused);
			return [back, cmds.map((c) => (c.type === "save" ? save({desk: savedOf(back)}) : c))];
		},
	}),
	/** A desk started again on a kept one starts fresh. */
	forgetsTheKept: {...deskMachine, init: (_loaded) => deskMachine.init(null, undefined)},
} satisfies Record<string, Machine>;

describe("the desk's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(deskMachine);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			// Focus left on a gone tile breaks the layout, and so the saves, the split and the restore.
			// A tile that is gone is open nowhere, either.
			focusOnTheGone: [
				whole.name,
				focusOpen.name,
				savesChanges.name,
				splitOpens.name,
				comesBack.name,
			],
			countsTheGone: [booksTidy.name],
			forgetsToOpen: [opensAndStops.name, splitOpens.name],
			closesTwice: [closesOnce.name],
			// An id given twice makes a split that does not split, and a kept desk that does not read.
			mintsTwice: [
				whole.name,
				opensAndStops.name,
				freshIds.name,
				savesChanges.name,
				splitOpens.name,
				comesBack.name,
			],
			quietResize: [savesChanges.name],
			grabsA: [takesWhatItSays.name],
			wakesUp: [takesWhatItSays.name, overStays.name],
			closesSilently: [emptiesAtTheEnd.name],
			// The saves law caught it too, by chance, until the frame's Msgs (go, pick, run) changed which
			// lists seed 1 makes; the law about y catches it on any list.
			yesIsNo: [yesCloses.name],
			// The tile the line was typed in is asked to close with no question of its own.
			closesTheLine: [closesOnce.name, yesCloses.name],
			deafToEnded: [endedGoes.name],
			swallowsCtrlC: [ctrlCReaches.name],
			splitKeepsFocus: [splitOpens.name],
			// A kept desk opens its focused tile again as it reads it, so the fold under focus shows there too.
			foldsUnderFocus: [focusOpen.name, comesBack.name],
			forgetsTheKept: [comesBack.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});
