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

/** tally's record read, count total open and chosen, then these Msgs. */
const opened = (record: JobTrace = TALLY_STARTED, more: readonly TraceMsg[] = []): Model =>
	foldEvents(trace, ctx, null, [
		{type: "look", id: TALLY_ID},
		{type: "got", trace: record},
		{type: "toggle", row: TALLY},
		{type: "toggle", row: COUNT},
		{type: "choose", row: COUNT},
		...more,
	]).finalState;

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

/** Every element `root` draws, each component called, with its text and whether a row holds it. */
const drawnFrom = (root: ReactNode): readonly Found[] => {
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
		const {all} = windowOf(opened());
		const buttons = all.filter((e) => e.type === "button" && e.text.includes(REPLAY));
		expect(buttons).toHaveLength(1);
		expect(buttons[0]?.inRow).toBe(false);
	});

	it("sends replay with the machine run's row when its button is pressed", () => {
		const {all, sent} = windowOf(opened());
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
		const {all} = windowOf(opened());
		expect(all.filter((e) => e.text.includes(NO_START_WORDS))).toEqual([]);
	});

	it("offers no replay in a step's detail", () => {
		const {all} = windowOf(opened(TALLY_STARTED, [{type: "choose", row: ADD_1}]));
		expect(all.filter((e) => e.type === "button" && e.text.includes(REPLAY))).toEqual([]);
	});

	it("shows the answer as text in a status region of the detail, so it is read out when it comes", () => {
		const {all, markup} = windowOf(replayed(opened(), MATCHES));
		const status = all.filter((e) => e.props.role === "status" && !e.inRow);
		expect(status.map((e) => e.text).join(" ")).toContain("matches at every step");
		expect(markup).toContain('role="status"');
	});

	it("keeps its status region in the detail while the replay is on its way", () => {
		const {all} = windowOf(replayed(opened()));
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
		expect(buttonsOf(windowOf(replayed(opened(), PARTS)).all, "Open step 2")).toHaveLength(1);
		expect(pressOf(replayed(opened(), PARTS), "Open step 2")).toEqual([
			{type: "choose", value: {row: ADD_2}},
		]);
	});

	it("offers to open the step where a replay is refused, and opening it chooses that step's row", () => {
		expect(pressOf(replayed(opened(), REFUSED), "Open step 1")).toEqual([
			{type: "choose", value: {row: ADD_1}},
		]);
	});

	it("offers to open no step when a replay matches or cannot be done, or before it is answered", () => {
		for (const s of [replayed(opened(), MATCHES), replayed(opened(), NO_CODE), replayed(opened())])
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
