import {applyCell} from "@demlik/tea";
import {type AskShown, askShownOf, blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {Effect} from "effect";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {DRAFT, NONE, NOW, policyFor} from "../../../fixtures/ask-desk/cases.ts";
import {askMachine, askView, type AskView} from "./ask-window.tsx";

// P8/P12/P15/P16. Today's shared ask editor, not the later inbox program.
type Editor =
	| {_tag: "reading"}
	| {_tag: "picks"}
	| {_tag: "note"; pick: string; text: string}
	| {_tag: "saving"; answer: unknown};
type Model = {
	ticket: number;
	ask: AskShown;
	editor: Editor;
	needed?: boolean;
	took: {ms: number; opened: readonly string[]};
	failure: string | null;
	status?: string;
};
type Msg =
	| {type: "do"; value: {_tag: "rec" | "not" | "picks" | "later"}}
	| {type: "pick"; pick: string}
	| {type: "note"; text: string}
	| {type: "submit"; key: string; now: number}
	| {type: "mark"; needed: boolean}
	| {type: "focus" | "active" | "visible"; value: boolean; now: number}
	| {type: "open"; name: string; now: number}
	| {type: "show"; ask: AskShown; now: number}
	| {type: "save_ok"; value: unknown}
	| {type: "save_err"; error: {why: string}}
	| {type: "tick"; now: number};
type Cmd = {type: string; [key: string]: unknown};
const start = async (hidden = false, rec: unknown = DRAFT.rec): Promise<Model> => {
	const ask = await Effect.runPromise(
		sealAsk({...DRAFT, rec}, policyFor(DRAFT.ask, hidden, blindDraw)),
	);
	const [model]: [Model, readonly Cmd[]] = askMachine.init(null, {
		ticket: 117,
		ask: askShownOf(ask),
		now: NOW,
	});
	return model;
};
const step = (model: Model, msg: Msg): readonly [Model, readonly Cmd[]] =>
	applyCell<Model, Msg, Cmd>(askMachine, model, msg);
const go = (model: Model, ...msgs: readonly Msg[]) =>
	msgs.reduce((m, msg) => step(m, msg)[0], model);

describe("ask desk P8: honest editor actions", () => {
	it.each([true, false])("rec is unavailable when hidden=%s or absent", async (hidden) => {
		const model = await start(hidden, hidden ? DRAFT.rec : NONE);
		const [after, cmds] = step(model, {type: "do", value: {_tag: "rec"}});
		expect(cmds).toEqual([]);
		expect(after.editor._tag).not.toBe("saving");
		const [picked, writes] = step(go(model, {type: "do", value: {_tag: "picks"}}), {
			type: "pick",
			pick: "approve",
		});
		expect(picked.editor).toMatchObject({_tag: "saving", answer: {_tag: "chose", pick: "approve"}});
		expect(writes).toHaveLength(1);
	});
	it("n means against the rec, including a stop rec, and every-pick obeys the same rule", async () => {
		const model = await start(false, {...DRAFT.rec, pick: "no"});
		expect(step(model, {type: "do", value: {_tag: "not"}})[0].editor).toEqual({
			_tag: "note",
			pick: "approve",
			text: "",
		});
		expect(
			go(model, {type: "do", value: {_tag: "picks"}}, {type: "pick", pick: "approve"}).editor,
		).toEqual({_tag: "note", pick: "approve", text: ""});
		expect(
			go(model, {type: "do", value: {_tag: "picks"}}, {type: "pick", pick: "no"}).editor,
		).toMatchObject({_tag: "saving", answer: {_tag: "rec"}});
	});
});

describe("ask desk P12: wait for the save", () => {
	it("keeps the selected ask and note through saving and failure; only acknowledgment completes it", async () => {
		const model = go(
			await start(),
			{type: "do", value: {_tag: "not"}},
			{type: "note", text: "The plan misses the empty input"},
		);
		const [saving, writes] = step(model, {type: "submit", key: "Enter", now: NOW + 300});
		expect(saving.ask.ask).toBe(DRAFT.ask);
		expect(saving.editor).toMatchObject({
			_tag: "saving",
			answer: {_tag: "against", pick: "no", note: "The plan misses the empty input"},
		});
		expect(writes).toHaveLength(1);
		const failed = step(saving, {type: "save_err", error: {why: "The plan changed"}})[0];
		expect(failed.ask.ask).toBe(DRAFT.ask);
		expect(failed.editor).toEqual(model.editor);
		expect(failed.failure).toBe("The plan changed");
		const [saved, notices] = step(saving, {type: "save_ok", value: {ticket: 117}});
		expect(saved.editor._tag).not.toBe("saving");
		expect(notices.some((cmd) => cmd.type === "answered")).toBe(true);
	});
	it("a blank note never writes, and a second press while saving never writes again", async () => {
		const model = go(await start(), {type: "do", value: {_tag: "not"}}, {type: "note", text: "  "});
		expect(step(model, {type: "submit", key: "Enter", now: NOW})[1]).toEqual([]);
		const saving = step(await start(), {type: "do", value: {_tag: "rec"}})[0];
		expect(step(saving, {type: "do", value: {_tag: "rec"}})[1]).toEqual([]);
	});
});

describe("ask desk P12: the saved line says what was saved", () => {
	it("reads Approved. after an approve, and names any other pick", async () => {
		const approving = step(await start(), {type: "do", value: {_tag: "rec"}})[0];
		expect(step(approving, {type: "save_ok", value: {ticket: 117}})[0].status).toBe("Approved.");
		const declining = go(
			await start(),
			{type: "do", value: {_tag: "not"}},
			{type: "note", text: "The plan misses the empty input"},
			{type: "submit", key: "Enter", now: NOW},
		);
		expect(step(declining, {type: "save_ok", value: {ticket: 117}})[0].status).toBe("no saved.");
	});
});

describe("ask desk P16: attention belongs to the ask", () => {
	it("counts only focused, visible time in an active window and preserves it on handoff", async () => {
		const model = go(
			await start(),
			{type: "focus", value: true, now: NOW},
			{type: "tick", now: NOW + 100},
			{type: "active", value: false, now: NOW + 100},
			{type: "tick", now: NOW + 1000},
			{type: "active", value: true, now: NOW + 1000},
			{type: "visible", value: false, now: NOW + 1100},
			{type: "tick", now: NOW + 2000},
			{type: "visible", value: true, now: NOW + 2000},
			{type: "focus", value: false, now: NOW + 2100},
			{type: "open", name: "questions", now: NOW + 2200},
			{type: "open", name: "plan", now: NOW + 2300},
			{type: "show", ask: (await start()).ask, now: NOW + 3000},
			{type: "focus", value: true, now: NOW + 3000},
			{type: "tick", now: NOW + 3100},
		);
		expect(model.took).toMatchObject({ms: 400, opened: ["questions", "plan"]});
		const another = {...model.ask, ask: "a-different-ask"};
		expect(go(model, {type: "show", ask: another, now: NOW + 3100}).took).toMatchObject({
			ms: 0,
			opened: [],
		});
	});
	it("never counts paused gaps of any length", async () => {
		const initial = await start();
		fc.assert(
			fc.property(fc.integer({min: 0, max: 1_000_000}), (gap) => {
				const model = go(
					initial,
					{type: "focus", value: true, now: NOW},
					{type: "focus", value: false, now: NOW + 20},
					{type: "tick", now: NOW + 20 + gap},
				);
				expect(model.took.ms).toBe(20);
			}),
			{seed: 119120, numRuns: 100},
		);
	});
});

describe("ask desk P17: optional marks in the editor", () => {
	it("starts unset, toggles each mark off, and lets an unmarked answer through", async () => {
		const model = await start();
		expect(model.needed).toBeUndefined();
		for (const needed of [true, false]) {
			const marked = go(model, {type: "mark", needed});
			expect(marked.needed).toBe(needed);
			expect(go(marked, {type: "mark", needed}).needed).toBeUndefined();
		}
		expect(step(model, {type: "do", value: {_tag: "rec"}})[1]).toHaveLength(1);
	});
});

it("hands the later inbox the shared view identity and display data", async () => {
	const draw: (model: Model) => AskView = askView;
	const view = draw(await start());
	expect(view).toMatchObject({key: `117/${DRAFT.ask}`, ticket: 117});
	expect(view.shows).toMatchObject({what: DRAFT.what, picks: DRAFT.picks});
});
