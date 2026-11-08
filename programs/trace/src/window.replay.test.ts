import {applyCell} from "@demlik/tea";
import {foldEvents, stubCtxThrowingProxy} from "@demlik/tea/pbt";
import type {JobTrace} from "@kampus/fabrika-old";
import {createElement, isValidElement, type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {type Model, type TraceMsg, trace} from "./machine.ts";
import {TALLY_ID, TALLY_STARTED, TALLY_TRACE} from "./tally.ts";
import {nodesOf, treeOf} from "./tree.ts";
import {type Shown, shownOf} from "./view.ts";
import {TraceWindow} from "./window.tsx";

// The replay in the trace's job view (docs/plan/replay-through-current-code.md, section 3). Today's
// version. A machine run's detail offers "Replay through current code", as a button in the detail
// and never inside its row: the row is a button already. The answer shows in the detail as text
// in a `role="status"` region, read out when it comes, and as words on the rows: the machine run's
// row says how it went, the parting step's row "parts from the recording", the refused one "no
// cell in today's code". Words, never color alone (WCAG 1.4.1).
//
// The first step's state before is the start the record kept, when it kept one.

const ctx = stubCtxThrowingProxy<undefined>();

const keyOf = (record: JobTrace, name: string): string => {
	const found = nodesOf(treeOf(record)).find((n) => n.name === name);
	if (found === undefined) throw new Error(`no row ${name}`);
	return found.key;
};

const TALLY = keyOf(TALLY_STARTED, "tally");
const COUNT = keyOf(TALLY_STARTED, "count total");
const ADD_1 = keyOf(TALLY_STARTED, "add 1");
const ADD_2 = keyOf(TALLY_STARTED, "add 2");
const ADD_3 = keyOf(TALLY_STARTED, "add 3");

/**
 * What `main` tells the trace when it starts, from its `Replayer`: the programs this app has code
 * for. Here tally's, so a machine run of tally can be replayed.
 */
const CODE: TraceMsg = {type: "code", programs: ["tally"]};

/** tally's record read, count total open and chosen, then these Msgs. `first`: told before it. */
const opened = (
	record: JobTrace = TALLY_STARTED,
	more: readonly TraceMsg[] = [],
	first: readonly TraceMsg[] = [],
): Model =>
	foldEvents(trace, ctx, null, [
		...first,
		{type: "look", id: TALLY_ID},
		{type: "got", trace: record},
		{type: "toggle", row: TALLY},
		{type: "toggle", row: COUNT},
		{type: "choose", row: COUNT},
		...more,
	]).finalState;

/** `opened`, told first that this app has code for tally. */
const coded = (record: JobTrace = TALLY_STARTED, more: readonly TraceMsg[] = []): Model =>
	opened(record, more, [CODE]);

/** tea's answer to a replay Cmd: the Cmd it answers, and the replay's answer. */
type ReplayOk = Extract<TraceMsg, {readonly type: "replay_ok"}>;

/** `s` with count total replayed, and answered with `value` when one is given. */
const replayed = (s: Model, value?: unknown): Model => {
	const [asked, cmds] = applyCell<Model, TraceMsg, never>(trace, s, {type: "replay", row: COUNT});
	if (value === undefined) return asked;
	const ok: ReplayOk = {
		type: "replay_ok",
		cmd: (cmds as readonly unknown[])[0] as ReplayOk["cmd"],
		value: value as ReplayOk["value"],
		at: 0,
	};
	return applyCell<Model, TraceMsg, never>(trace, asked, ok)[0];
};

const MATCHES = {_tag: "matches", steps: 3} as const;
const PARTS = {
	_tag: "parts",
	n: 2,
	msg: {type: "add", n: 2},
	path: "state.total",
	recorded: 3,
	replayed: 4,
} as const;
const REFUSED = {
	_tag: "refused",
	n: 1,
	msg: {type: "add", n: 1},
	state: "(untagged state)",
	accepts: [],
} as const;
const NO_CODE = {
	_tag: "cannot",
	why: "no_code",
	n: null,
	detail: "today's code lists no program tally",
} as const;

/** Each row's replay words, by key, for the rows that say any. */
const wordsOf = (view: Shown) =>
	Object.fromEntries(view.rows.flatMap((r) => (r.replay === null ? [] : [[r.key, r.replay]])));

describe("the job view's replay, as shown", () => {
	it("shows the first step's state before as the start the record kept, and its changes against it", () => {
		const chosen = shownOf(opened(TALLY_STARTED, [{type: "choose", row: ADD_1}])).chosen;
		expect(chosen?.kind === "step" && [chosen.before, chosen.after, chosen.changes]).toEqual([
			{kind: "kept", state: {total: 0}},
			{total: 1},
			[{op: "replace", path: "/total", before: 0, after: 1}],
		]);
	});

	it("still shows the first step's state before as the machine's start for a record that kept none", () => {
		const s = foldEvents(trace, ctx, null, [
			{type: "look", id: TALLY_ID},
			{type: "got", trace: TALLY_TRACE},
			{type: "choose", row: ADD_1},
		]).finalState;
		const chosen = shownOf(s).chosen;
		expect(chosen?.kind === "step" && chosen.before).toEqual({kind: "start"});
	});

	it("offers no replay words before one is asked: the machine run's detail says none was", () => {
		const view = shownOf(opened());
		expect(view.chosen).toMatchObject({kind: "machine", replay: null});
		expect(wordsOf(view)).toEqual({});
	});

	it("says a replay is on its way once asked, and puts no words on the rows yet", () => {
		const view = shownOf(replayed(opened()));
		expect(view.chosen).toMatchObject({kind: "machine", replay: {answer: null}});
		expect(view.chosen?.kind === "machine" && view.chosen.replay?.says).toEqual(expect.any(String));
		expect(wordsOf(view)).toEqual({});
	});

	it("says a replay that matches on the machine run's row, and in the detail", () => {
		const view = shownOf(replayed(opened(), MATCHES));
		expect(wordsOf(view)).toEqual({[COUNT]: "matches at every step"});
		expect(view.chosen).toMatchObject({kind: "machine", replay: {answer: MATCHES}});
		expect(view.chosen?.kind === "machine" && view.chosen.replay?.says).toContain(
			"matches at every step",
		);
	});

	it("says where a replay parts: on the machine run's row, on the parting step's row, and in the detail", () => {
		const view = shownOf(replayed(opened(), PARTS));
		expect(wordsOf(view)).toEqual({
			[COUNT]: "parts at step 2",
			[ADD_2]: "parts from the recording",
		});
		expect(view.chosen?.kind === "machine" && view.chosen.replay?.says).toContain(
			"parts at step 2",
		);
	});

	it("says where a replay is refused: on the machine run's row, on the refused step's row, and in the detail", () => {
		const view = shownOf(replayed(opened(), REFUSED));
		expect(wordsOf(view)).toEqual({
			[COUNT]: "no cell for step 1",
			[ADD_1]: "no cell in today's code",
		});
		expect(view.chosen?.kind === "machine" && view.chosen.replay?.says).toContain(
			"no cell for step 1",
		);
	});

	it("says why a replay cannot be done, in the detail", () => {
		const view = shownOf(replayed(opened(), NO_CODE));
		expect(view.chosen?.kind === "machine" && view.chosen.replay?.says).toContain(
			"today's code lists no program tally",
		);
		expect(Object.keys(wordsOf(view))).not.toContain(ADD_1);
		expect(Object.keys(wordsOf(view))).not.toContain(ADD_3);
	});
});

// The window, at the level ./window.tree.test.ts tests it: React elements with no browser. The
// window's components keep no state, so a test calls each one to see what it draws.

interface Found {
	readonly type: unknown;
	readonly props: Record<string, unknown>;
	/** Inside a tree grid row: an element with `data-row`. */
	readonly inRow: boolean;
	readonly text: string;
}

/**
 * Every element `root` draws, each component called, with its text and whether a row holds it.
 * The walk runs inside a server render, so a component that uses a hook (an effect that moves
 * focus) is called where React lets it be; the server runs no effect, so what is drawn is the same.
 */
const drawnFrom = (root: ReactNode): readonly Found[] => {
	let found: readonly Found[] = [];
	const Walk = () => {
		found = walkOf(root);
		return null;
	};
	renderToStaticMarkup(createElement(Walk));
	return found;
};

const walkOf = (root: ReactNode): readonly Found[] => {
	const out: Found[] = [];
	const call = (n: ReactNode): ReactNode =>
		isValidElement<Record<string, unknown>>(n) && typeof n.type === "function"
			? call((n.type as (p: unknown) => ReactNode)(n.props))
			: n;
	const textOf = (n: ReactNode): string => {
		const c = call(n);
		if (typeof c === "string" || typeof c === "number") return String(c);
		if (Array.isArray(c)) return c.map(textOf).join("");
		if (!isValidElement<Record<string, unknown>>(c)) return "";
		return textOf(c.props.children as ReactNode);
	};
	const walk = (n: ReactNode, inRow: boolean): void => {
		const c = call(n);
		if (Array.isArray(c)) {
			for (const x of c) walk(x, inRow);
			return;
		}
		if (!isValidElement<Record<string, unknown>>(c)) return;
		const row = inRow || typeof c.props["data-row"] === "string";
		out.push({type: c.type, props: c.props, inRow: row, text: textOf(c)});
		walk(c.props.children as ReactNode, row);
	};
	walk(root, false);
	return out;
};

/** What the window draws for `s`, its markup, and what it sends. */
const windowOf = (s: Model) => {
	const sent: unknown[] = [];
	const view = shownOf(s);
	const all = drawnFrom(TraceWindow({view, send: (m) => sent.push(m)}));
	const markup = renderToStaticMarkup(createElement(TraceWindow, {view, send: () => {}}));
	return {all, sent, markup};
};

const REPLAY = "Replay through current code";
/** What a machine run with no start kept says in its detail, in place of the button. */
const NO_START_WORDS = "Recorded before starts were kept, so it can't be replayed.";

describe("the job view's replay, as the window draws it", () => {
	it("offers the replay as a button in the machine run's detail, never inside its row", () => {
		const {all} = windowOf(coded());
		const buttons = all.filter((e) => e.type === "button" && e.text.includes(REPLAY));
		expect(buttons).toHaveLength(1);
		expect(buttons[0]?.inRow).toBe(false);
	});

	it("sends replay with the machine run's row when its button is pressed", () => {
		const {all, sent} = windowOf(coded());
		const button = all.find((e) => e.type === "button" && e.text.includes(REPLAY));
		const press = button?.props.onClick;
		if (typeof press !== "function") throw new Error("the replay button takes no click");
		press();
		expect(sent).toEqual([{type: "replay", value: {row: COUNT}}]);
	});

	it("offers no replay for a machine run whose start was never kept, and says why in the detail", () => {
		const {all} = windowOf(opened(TALLY_TRACE));
		expect(all.filter((e) => e.type === "button" && e.text.includes(REPLAY))).toEqual([]);
		expect(all.filter((e) => !e.inRow && e.text.includes(NO_START_WORDS))).not.toEqual([]);
	});

	it("says nothing of starts for a machine run whose start was kept", () => {
		const {all} = windowOf(coded());
		expect(all.filter((e) => e.text.includes(NO_START_WORDS))).toEqual([]);
	});

	it("offers no replay in a step's detail", () => {
		const {all} = windowOf(coded(TALLY_STARTED, [{type: "choose", row: ADD_1}]));
		expect(all.filter((e) => e.type === "button" && e.text.includes(REPLAY))).toEqual([]);
	});

	it("shows the answer as text in a status region of the detail, so it is read out when it comes", () => {
		const {all, markup} = windowOf(replayed(coded(), MATCHES));
		const status = all.filter((e) => e.props.role === "status" && !e.inRow);
		expect(status.map((e) => e.text).join(" ")).toContain("matches at every step");
		expect(markup).toContain('role="status"');
	});

	it("keeps its status region in the detail while the replay is on its way", () => {
		const {all} = windowOf(replayed(coded()));
		expect(all.filter((e) => e.props.role === "status" && !e.inRow)).not.toEqual([]);
	});

	it("says on the rows, in words, where a replay parts and where it is refused", () => {
		const parts = windowOf(replayed(opened(), PARTS));
		const rowText = (all: readonly Found[], key: string) =>
			all.find((e) => e.props["data-row"] === key)?.text ?? "";
		expect(rowText(parts.all, COUNT)).toContain("parts at step 2");
		expect(rowText(parts.all, ADD_2)).toContain("parts from the recording");
		expect(rowText(parts.all, ADD_1)).not.toContain("parts");
		const refused = windowOf(replayed(opened(), REFUSED));
		expect(rowText(refused.all, COUNT)).toContain("no cell for step 1");
		expect(rowText(refused.all, ADD_1)).toContain("no cell in today's code");
		const matches = windowOf(replayed(opened(), MATCHES));
		expect(rowText(matches.all, COUNT)).toContain("matches at every step");
	});
});

// Two fixes from the shots. In a small tile the parting step's row is scrolled out of view under
// the machine run's detail, and its words are cut, so the detail itself offers to open that step.
// And the detail shows where the machine run started: the first start the record kept.

/** The buttons the window draws outside every row whose text starts with `words`. */
const buttonsOf = (all: readonly Found[], words: string) =>
	all.filter((e) => e.type === "button" && !e.inRow && e.text.trim().startsWith(words));

/** What a press of the one button starting with `words` sends. */
const pressOf = (s: Model, words: string): readonly unknown[] => {
	const {all, sent} = windowOf(s);
	const [button, ...more] = buttonsOf(all, words);
	if (button === undefined || more.length > 0) throw new Error(`not one "${words}" button`);
	const press = button.props.onClick;
	if (typeof press !== "function") throw new Error(`the "${words}" button takes no click`);
	press();
	return sent;
};

/** The parts of the detail, outside every row, whose text begins with the label "started from". */
const startedFrom = (all: readonly Found[]) =>
	all.filter((e) => !e.inRow && e.text.trim().toLowerCase().startsWith("started from"));

describe("the machine run's detail, after a replay", () => {
	it("offers to open the step where a replay parts, and opening it chooses that step's row", () => {
		expect(buttonsOf(windowOf(replayed(coded(), PARTS)).all, "Open step 2")).toHaveLength(1);
		expect(pressOf(replayed(coded(), PARTS), "Open step 2")).toEqual([
			{type: "choose", value: {row: ADD_2}},
		]);
	});

	it("offers to open the step where a replay is refused, and opening it chooses that step's row", () => {
		expect(pressOf(replayed(coded(), REFUSED), "Open step 1")).toEqual([
			{type: "choose", value: {row: ADD_1}},
		]);
	});

	it("offers to open no step when a replay matches or cannot be done, or before it is answered", () => {
		for (const s of [replayed(coded(), MATCHES), replayed(coded(), NO_CODE), replayed(coded())])
			expect(buttonsOf(windowOf(s).all, "Open step")).toEqual([]);
	});
});

describe("the machine run's detail, where it started", () => {
	it("shows the first start the record kept, under the label started from", () => {
		const found = startedFrom(windowOf(opened()).all);
		expect(found).not.toEqual([]);
		expect(found.some((e) => e.text.replaceAll(/\s/g, "").includes('{"total":0}'))).toBe(true);
	});

	it("shows no started from for a machine run whose start was never kept", () => {
		expect(startedFrom(windowOf(opened(TALLY_TRACE)).all)).toEqual([]);
	});
});

// The review round (docs/plan/replay-through-current-code.md, section 3, added 2026-11-08).

/** `s` with `msg` stepped by the real cell. */
const stepped = (s: Model, msg: TraceMsg): Model =>
	applyCell<Model, TraceMsg, never>(trace, s, msg)[0];

/** The tree grid's rows the window draws whose `tabIndex` is 0: where Tab lands in the tree. */
const focusableOf = (all: readonly Found[]): readonly unknown[] =>
	all
		.filter((e) => e.type === "tr" && typeof e.props["data-row"] === "string")
		.filter((e) => e.props.tabIndex === 0)
		.map((e) => e.props["data-row"]);

/** The step's detail the window draws, by its label. */
const stepDetailOf = (all: readonly Found[], label: string) =>
	all.filter((e) => e.type === "section" && e.props["aria-label"] === label);

describe("opening the step a replay names, under a closed machine run", () => {
	// The review's repro: count total chosen, then closed, replayed, and its parting step opened.
	const closed = (): Model => replayed(coded(TALLY_STARTED, [{type: "toggle", row: COUNT}]), PARTS);

	it("shows the step chosen: its row is drawn, and so is its detail", () => {
		const s = stepped(closed(), {type: "choose", row: ADD_2});
		const view = shownOf(s);
		expect(view.rows.map((r) => r.key)).toContain(ADD_2);
		expect(view.chosen).toMatchObject({kind: "step", n: 2});
		expect(stepDetailOf(windowOf(s).all, "step 2 of count total")).toHaveLength(1);
	});

	it("puts the tree's focus on that step's row once Open step 2 is pressed", () => {
		const [sent] = pressOf(closed(), "Open step 2");
		expect(sent).toEqual({type: "choose", value: {row: ADD_2}});
		const s = stepped(closed(), {type: "choose", row: ADD_2});
		expect(focusableOf(windowOf(s).all)).toEqual([ADD_2]);
	});

	it("always has exactly one row of the tree that Tab lands on, the chosen one where it shows", () => {
		const states: readonly (readonly [string, Model])[] = [
			[
				"read, nothing chosen",
				foldEvents(trace, ctx, null, [
					{type: "look", id: TALLY_ID},
					{type: "got", trace: TALLY_STARTED},
				]).finalState,
			],
			["count total chosen", coded()],
			["count total chosen, then closed", coded(TALLY_STARTED, [{type: "toggle", row: COUNT}])],
			[
				"count total chosen, then tally closed above it",
				coded(TALLY_STARTED, [{type: "toggle", row: TALLY}]),
			],
			["step 2 opened from a closed machine run", stepped(closed(), {type: "choose", row: ADD_2})],
			["nothing chosen again", coded(TALLY_STARTED, [{type: "choose", row: null}])],
		];
		for (const [name, s] of states)
			expect([name, focusableOf(windowOf(s).all).length]).toEqual([name, 1]);
		expect(focusableOf(windowOf(coded()).all)).toEqual([COUNT]);
	});
});

// A restart is a new life, replayed from its own start: the first step after it folded from that
// start, not from the step before it.

const [FIRST_START] = TALLY_STARTED.starts;
if (FIRST_START === undefined) throw new Error("TALLY_STARTED keeps no start");

/** tally's record with count total restarted after step 2, at `state`. */
const restartedAt = (state: unknown): JobTrace => ({
	...TALLY_STARTED,
	starts: [
		...TALLY_STARTED.starts,
		{...FIRST_START, n: 2, after: 2, at: FIRST_START.at + 5, state},
	],
});

/** tally's record with step 2 leaving `left`, then count total restarted after it at `state`. */
const restartedWith = (left: unknown, state: unknown): JobTrace => {
	const record = restartedAt(state);
	return {...record, steps: record.steps.map((s) => (s.n === 2 ? {...s, state: left} : s))};
};

const RESTARTED_WORDS = "Restarted from this state; the step before left";
/** `text` with no white space, so a JSON value reads the same however it is laid out. */
const tight = (text: string) => text.replaceAll(/\s/g, "");
/** The text of every block of code drawn outside the rows (`pre`), with no white space. */
const blocksOf = (all: readonly Found[]) =>
	all.filter((e) => !e.inRow && e.type === "pre").map((e) => tight(e.text));

describe("the first step of a later life", () => {
	it("shows that life's start as its state before, and its changes against it", () => {
		const chosen = shownOf(opened(restartedAt({total: 10}), [{type: "choose", row: ADD_3}])).chosen;
		expect(chosen?.kind === "step" && [chosen.before, chosen.after, chosen.changes]).toEqual([
			{kind: "kept", state: {total: 10}},
			{total: 6},
			[{op: "replace", path: "/total", before: 10, after: 6}],
		]);
	});

	it("says it restarted from a state the step before did not leave, and what that step left", () => {
		const {all} = windowOf(opened(restartedAt({total: 10}), [{type: "choose", row: ADD_3}]));
		expect(all.filter((e) => !e.inRow && e.text.includes(RESTARTED_WORDS))).not.toEqual([]);
		expect(blocksOf(all)).toContain('{"total":3}');
	});

	// tea owns equality (the plan's "Two rules, after the second review"): a state is compared with
	// tea's `deepEqual`, never as JSON text, and a state inside a sentence is drawn as a block.
	it("says nothing more when the start is the state the step before left, its keys in another order", () => {
		// The step's state came from a patch, its new key last; the start from the schema, in its order.
		const record = restartedWith({total: 3, seen: 2}, {seen: 2, total: 3});
		const s = opened(record, [{type: "choose", row: ADD_3}]);
		const chosen = shownOf(s).chosen;
		expect(chosen?.kind === "step" && [chosen.before, chosen.restarted]).toEqual([
			{kind: "kept", state: {seen: 2, total: 3}},
			null,
		]);
		expect(windowOf(s).all.filter((e) => e.text.includes("Restarted from"))).toEqual([]);
	});

	it("draws what the step before left as a block, never inline, however big", () => {
		const left = {total: 3, seen: Array.from({length: 40}, (_, i) => i), note: "x".repeat(120)};
		const {all} = windowOf(
			opened(restartedWith(left, {total: 10}), [{type: "choose", row: ADD_3}]),
		);
		expect(all.filter((e) => !e.inRow && e.text.includes(RESTARTED_WORDS))).not.toEqual([]);
		expect(blocksOf(all)).toContain(tight(JSON.stringify(left)));
		expect(all.filter((e) => e.type === "code" && e.text.includes('"total"'))).toEqual([]);
	});

	it("says nothing more when it restarted from the very state the step before left", () => {
		const s = opened(restartedAt({total: 3}), [{type: "choose", row: ADD_3}]);
		const chosen = shownOf(s).chosen;
		expect(chosen?.kind === "step" && chosen.before).toEqual({kind: "kept", state: {total: 3}});
		expect(windowOf(s).all.filter((e) => e.text.includes("Restarted from"))).toEqual([]);
	});

	it("says nothing of a restart on a step that is not the first of a later life", () => {
		for (const row of [ADD_1, ADD_2]) {
			const s = opened(restartedAt({total: 10}), [{type: "choose", row}]);
			expect(windowOf(s).all.filter((e) => e.text.includes("Restarted from"))).toEqual([]);
		}
	});
});

// The button shows only for a program this app has code for: the lane's stages run in the host's
// process, so a machine run of a program it cannot replay is no rare case, and a button that could
// only answer "no code" is a dead one.

/** What a machine run of `program` says in place of the button, when this app has no code for it. */
const noCodeWords = (program: string) =>
	`This app has no code for ${program}, so it can't be replayed here.`;

describe("the replay, only for a program this app has code for", () => {
	it("offers no replay before it is told of any code, and says why in the detail", () => {
		const {all} = windowOf(opened());
		expect(buttonsOf(all, REPLAY)).toEqual([]);
		expect(all.filter((e) => !e.inRow && e.text.trim() === noCodeWords("tally"))).not.toEqual([]);
	});

	it("offers no replay when the code it was told of is other programs'", () => {
		const {all} = windowOf(opened(TALLY_STARTED, [], [{type: "code", programs: ["seq"]}]));
		expect(buttonsOf(all, REPLAY)).toEqual([]);
		expect(all.filter((e) => !e.inRow && e.text.trim() === noCodeWords("tally"))).not.toEqual([]);
	});

	it("offers the replay once told this app has code for tally, and says nothing of no code", () => {
		const {all} = windowOf(coded());
		expect(buttonsOf(all, REPLAY)).toHaveLength(1);
		expect(all.filter((e) => e.text.includes("has no code for"))).toEqual([]);
	});

	it("still says a machine run with no start kept can't be replayed, whatever code it was told of", () => {
		for (const s of [opened(TALLY_TRACE), coded(TALLY_TRACE)]) {
			const {all} = windowOf(s);
			expect(buttonsOf(all, REPLAY)).toEqual([]);
			expect(all.filter((e) => !e.inRow && e.text.includes(NO_START_WORDS))).not.toEqual([]);
			expect(all.filter((e) => e.text.includes("has no code for"))).toEqual([]);
		}
	});
});

// From the mutation step (seed 119120, at 4fcbb2ee): the words exactly, the rows' names and marks,
// and the starts of a machine run picked by its run, machine and id together.

/** The answer's words in the machine run's detail, said whole. */
const saysFor = (answer: unknown) => {
	const chosen = shownOf(replayed(opened(), answer)).chosen;
	return chosen?.kind === "machine" ? chosen.replay?.says : undefined;
};

describe("the replay's answer, said whole", () => {
	it("says how many steps matched, one step or many", () => {
		expect(saysFor({_tag: "matches", steps: 1})).toBe(
			"Replayed through current code: matches at every step, 1 step.",
		);
		expect(saysFor(MATCHES)).toBe("Replayed through current code: matches at every step, 3 steps.");
	});

	it("says a refusal in a state with no tag, where today's code takes no Msg, without naming the state", () => {
		expect(saysFor(REFUSED)).toBe(
			"Replayed through current code: no cell for step 1 (add 1). Today's code takes no Msg there.",
		);
	});

	it("says a refusal in a tagged state by its tag, and the Msgs today's code takes there", () => {
		expect(saysFor({...REFUSED, state: "counting", accepts: ["add", "reset"]})).toBe(
			"Replayed through current code: no cell for step 1 (add 1) in counting. Today's code takes add, reset.",
		);
	});
});

/** The accessible name of the tree grid's row `key`, as the window draws it. */
const nameOf = (s: Model, key: string) =>
	windowOf(s).all.find((e) => e.type === "tr" && e.props["data-row"] === key)?.props["aria-label"];

/** The marks beside row `key`'s replay words: hidden from a screen reader, which reads the words. */
const marksIn = (s: Model, key: string) => {
	const row = windowOf(s).all.find((e) => e.type === "tr" && e.props["data-row"] === key);
	if (row === undefined) throw new Error(`no row ${key}`);
	return drawnFrom(row.props.children as ReactNode)
		.filter((e) => e.props.className === "wf-replayed")
		.flatMap((e) => drawnFrom(e.props.children as ReactNode))
		.filter((e) => e.props["aria-hidden"] === "true")
		.map((e) => e.text.trim());
};

describe("the rows' replay words, for a screen reader and by eye", () => {
	it("names a row with its replay words, and with none before an answer", () => {
		expect(nameOf(opened(), "job")).toBe("job seq --to 3 | tally");
		expect(nameOf(opened(), COUNT)).toBe("machine run count total, 3 steps");
		expect(nameOf(replayed(opened()), COUNT)).toBe("machine run count total, 3 steps");
		expect(nameOf(replayed(opened(), MATCHES), COUNT)).toBe(
			"machine run count total, 3 steps, replayed: matches at every step",
		);
		expect(nameOf(replayed(opened(), PARTS), COUNT)).toBe(
			"machine run count total, 3 steps, replayed: parts at step 2",
		);
		expect(nameOf(replayed(opened(), PARTS), ADD_2)).toBe(
			"step add 2, step 2, replayed: parts from the recording",
		);
		expect(nameOf(replayed(opened(), PARTS), ADD_1)).toBe("step add 1, step 1");
		expect(nameOf(replayed(opened(), REFUSED), ADD_1)).toBe(
			"step add 1, step 1, replayed: no cell in today's code",
		);
		expect(nameOf(replayed(opened(), NO_CODE), COUNT)).toBe(
			"machine run count total, 3 steps, replayed: can't be replayed",
		);
	});

	it("marks a match, a parting and a refusal, each its own way, and a replay that cannot be done not at all", () => {
		expect(marksIn(replayed(opened(), MATCHES), COUNT)).toEqual(["✓"]);
		expect(marksIn(replayed(opened(), PARTS), COUNT)).toEqual(["✕"]);
		expect(marksIn(replayed(opened(), PARTS), ADD_2)).toEqual(["✕"]);
		expect(marksIn(replayed(opened(), REFUSED), ADD_1)).toEqual(["⊘"]);
		expect(marksIn(replayed(opened(), NO_CODE), COUNT)).toEqual([]);
		expect(marksIn(replayed(opened()), COUNT)).toEqual([]);
	});
});

/** tally's record with starts of other machine runs beside count total's: same id, other owners. */
const BESIDE: JobTrace = {
	...TALLY_STARTED,
	starts: [
		...TALLY_STARTED.starts,
		...[{run: "seq-3f9a1c02"}, {machine: "sum"}, {id: "other"}].map((other) => ({
			...FIRST_START,
			...other,
			n: 2,
			state: {total: 99},
		})),
	],
};

describe("a machine run's starts, beside other machine runs' starts", () => {
	it("starts count total from its own start, though other runs, machines and ids kept starts too", () => {
		const machine = shownOf(opened(BESIDE)).chosen;
		expect(machine?.kind === "machine" && machine.started).toEqual({state: {total: 0}});
		const step = shownOf(opened(BESIDE, [{type: "choose", row: ADD_1}])).chosen;
		expect(step?.kind === "step" && [step.before, step.restarted]).toEqual([
			{kind: "kept", state: {total: 0}},
			null,
		]);
	});
});

// A live region says one short sentence (the plan's "Two more, after the third review"): a
// `status` region is read whole on every change (WAI-ARIA 1.2: aria-live polite, aria-atomic
// true), so it holds the answer's sentence alone, and the values it parts on are drawn after it.

/** Where a replay parts with values that fit on one line: tally's total, 3 recorded, 6 now. */
const SHORT = {...PARTS, path: "state.total", recorded: 3, replayed: 6} as const;
/** Where a replay parts on the whole state, each side over 64 characters as JSON. */
const LONG = {
	...PARTS,
	path: "state",
	recorded: {total: 3, note: "x".repeat(80)},
	replayed: {total: 6, note: "y".repeat(80)},
} as const;

/** The answer's status region the window draws, and everything drawn inside it. */
const statusOf = (all: readonly Found[]) => {
	const [region, ...more] = all.filter((e) => !e.inRow && e.props.role === "status");
	if (region === undefined || more.length > 0) throw new Error("not one status region");
	return {region, inside: drawnFrom(region.props.children as ReactNode)};
};

describe("the replay's answer, as one short sentence in its status region", () => {
	it("names the path and both values where each fits on one line", () => {
		expect(saysFor(SHORT)).toContain("at total: 3 in the recording, 6 now");
	});

	it("says the values are shown below where one is over 64 characters, and does not read them out", () => {
		const says = saysFor(LONG) ?? "";
		expect(says).toContain("shown below");
		expect(says).not.toContain("xxxx");
		expect(says).not.toContain("yyyy");
	});

	it("holds only its sentence: no block of code inside the region", () => {
		for (const answer of [SHORT, LONG, MATCHES, REFUSED, NO_CODE]) {
			const s = replayed(coded(), answer);
			const chosen = shownOf(s).chosen;
			const says = chosen?.kind === "machine" ? chosen.replay?.says : undefined;
			const {region, inside} = statusOf(windowOf(s).all);
			expect(inside.filter((e) => e.type === "pre" || e.type === "figure")).toEqual([]);
			expect(region.text.trim()).toBe(says);
		}
	});

	it("draws the two values right after the region, outside it", () => {
		const {all} = windowOf(replayed(coded(), LONG));
		const {region, inside} = statusOf(all);
		expect(inside.filter((e) => e.type === "pre")).toEqual([]);
		const at = all.indexOf(region);
		const blocks = all.filter((e) => !e.inRow && e.type === "pre").map((e) => all.indexOf(e));
		const recorded = blocks.find((i) => tight(all[i]?.text ?? "").includes("x".repeat(80)));
		const now = blocks.find((i) => tight(all[i]?.text ?? "").includes("y".repeat(80)));
		expect(recorded).toBeGreaterThan(at);
		expect(now).toBeGreaterThan(recorded ?? Infinity);
		// Right after: nothing but the two blocks' own frames lies between the region and them.
		const between = all
			.slice(at + 1, now)
			.filter((e) => e.type === "button" || e.props.role === "status");
		expect(between).toEqual([]);
	});
});
