import {
	arbConstantMsg,
	arbMsg,
	arbMsgSequence,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
import {
	type AskShown,
	askShownOf,
	AskCommand,
	blindDraw,
	sealAsk,
} from "@kampus/pipeline/tickets/ask";
import {Effect} from "effect";
import * as fc from "fast-check";
import {beforeAll, describe, expect, it} from "vitest";
import {DRAFT, NONE, NOW, PICKS, policyFor} from "../../../fixtures/ask-desk/cases.ts";
import {askMachine, askView} from "./ask-window.tsx";

// The laws of today's shared ask editor (askMachine), on tea's pbt: after every step of any list
// of Msgs, from the real init, on four sealed asks: a shown rec with two picks, a shown rec with
// three, a hidden rec, and no rec. Each law is a row of the ask-desk plan's property table
// (../askdesk-PLAN.md, "Properties"), and each has a planted mistake below that it catches.

type Machine = typeof askMachine;
type Msg = MsgOf<Machine>;
type Model = ReturnType<Machine["init"]>[0];
type AskStep = Step<Model, Msg, {readonly type: string; readonly [key: string]: unknown}>;

const THIRD = {pick: "stop", does: "Stop the lane here"};
let ASKS: readonly AskShown[] = [];
// A blind ask is a step's: an approve ask is never drawn blind (review 2, medium 2).
const seal = (rec: unknown, picks: typeof PICKS, ask: string, hidden: boolean) =>
	Effect.runPromise(
		sealAsk(
			{...DRAFT, ask, rec, picks, ...(hidden ? {for: "step"} : {})},
			policyFor(ask, hidden, blindDraw),
		).pipe(Effect.map(askShownOf)),
	);
beforeAll(async () => {
	ASKS = [
		await seal(DRAFT.rec, PICKS, "a-approve-1", false),
		await seal({...DRAFT.rec, pick: "no"}, [...PICKS, THIRD], "a-approve-2", false),
		await seal(DRAFT.rec, PICKS, "a-approve-3", true),
		await seal(NONE, [...PICKS, THIRD], "a-approve-4", false),
	];
});

// ---------------------------------------------------------------- generators

const now = fc.nat({max: 1_000_000});
const key = fc.constantFrom("y", "n", "o", "1", "2", "click");
const pick = fc.constantFrom("approve", "no", "stop", "not offered");
const command = fc.constantFrom(
	AskCommand.cases.rec.make({}),
	AskCommand.cases.not.make({}),
	AskCommand.cases.picks.make({}),
	AskCommand.cases.later.make({}),
);
const table = (): MsgArbitraryTable<Msg> => ({
	do: arbRecordMsg("do", {value: command, key, now}),
	pick: arbRecordMsg("pick", {pick, key, now}),
	note: arbRecordMsg("note", {text: fc.constantFrom("", "   ", "the second file needs a look")}),
	submit: arbRecordMsg("submit", {key: fc.constant("Enter"), now}),
	mark: arbRecordMsg("mark", {needed: fc.boolean()}),
	// The editor types these three as one Msg with a `type` union, which the table cannot narrow.
	focus: arbRecordMsg("focus", {value: fc.boolean(), now}) as fc.Arbitrary<never>,
	active: arbRecordMsg("active", {value: fc.boolean(), now}) as fc.Arbitrary<never>,
	visible: arbRecordMsg("visible", {value: fc.boolean(), now}) as fc.Arbitrary<never>,
	open: arbRecordMsg("open", {name: fc.constantFrom("evidence", "questions"), now}),
	show: arbRecordMsg("show", {ask: fc.constantFrom(...ASKS), now}),
	tick: arbRecordMsg("tick", {now}),
	escape: arbConstantMsg("escape"),
	save_ok: arbRecordMsg("save_ok", {value: fc.constant(null)}),
	save_err: arbRecordMsg("save_err", {error: fc.constant({why: "The ask was withdrawn"})}),
	// The Cmds' own answers; their cells change nothing, so their Cmd and value are not read.
	answered_ok: arbRecordMsg("answered_ok", {value: fc.constant(null)}) as fc.Arbitrary<never>,
	later_ok: arbRecordMsg("later_ok", {value: fc.constant(null)}) as fc.Arbitrary<never>,
	// Neither Cmd can fail, so these never come: their rows draw a tick instead.
	answered_err: arbRecordMsg("tick", {now}) as fc.Arbitrary<never>,
	later_err: arbRecordMsg("tick", {now}) as fc.Arbitrary<never>,
});
const OPTS = {numRuns: 150, seed: 119120};

const savesOf = (step: AskStep) =>
	step.cmds.flatMap((c) => (c.type === "save" ? [c as Record<string, unknown>] : []));
const tookRec = (ask: AskShown) =>
	ask.shows.rec._tag === "pick" ? "shown" : ask.shows.rec._tag === "hidden" ? "hidden" : "none";

// ---------------------------------------------------------------- the laws

interface Law {
	readonly name: string;
	readonly check: (machine: Machine) => void;
}

const every = (
	name: string,
	law: (step: AskStep) => boolean | string,
	prefix: readonly Msg[] = [],
): Law => ({
	name,
	check: (machine) => {
		for (const ask of ASKS)
			propertyInvariant(
				machine,
				{ticket: 117, ask, now: NOW},
				arbMsgSequence(arbMsg(table()), {prefix, maxLength: 30, size: "max"}),
				law as never,
				OPTS,
			);
	},
});

/**
 * Property 7 and 8: `rec` is only saved while a rec is shown, and means that ask's rec; `against`
 * needs a shown rec, another offered pick and a nonblank note; a hidden or absent rec saves only
 * `chose`. Every save names the ask on screen, its display hash, and how the rec was in view.
 */
const honestAnswers = every("a save is only an answer the shown ask offers", (step) => {
	const ask = step.prev.ask;
	const rec = ask.shows.rec;
	for (const save of savesOf(step)) {
		const answer = save.answer as {_tag: string; pick?: string; note?: string};
		const via = save.via as {took: {rec: string}};
		if (save.ask !== ask.ask || save.saw !== ask.saw) return "the save is not about the ask shown";
		if (via.took.rec !== tookRec(ask)) return "the save misstates whether the rec was in view";
		if (answer._tag === "rec" && rec._tag !== "pick") return "rec saved with no rec shown";
		if (answer._tag !== "rec" && !ask.shows.picks.some((p) => p.pick === answer.pick))
			return `${answer.pick} is not offered`;
		if (answer._tag === "chose" && rec._tag === "pick") return "chose saved with the rec shown";
		if (answer._tag === "against") {
			if (rec._tag !== "pick") return "against saved with no rec shown";
			if (answer.pick === rec.pick) return "against saved on the rec's own pick";
			if ((answer.note ?? "").trim() === "") return "against saved with a blank note";
		}
	}
	return true;
});

const choiceNotes = every(
	"a no-rec pick waits for an optional note, and Enter keeps it exactly",
	(step) => {
		const {prev, msg, next} = step;
		if (prev.ask.shows.rec._tag === "pick" || prev.editor._tag === "saving") return true;
		const saves = savesOf(step);
		if (msg.type === "pick" && prev.ask.shows.picks.some((p) => p.pick === msg.pick)) {
			if (saves.length !== 0) return "a no-rec pick saved before the optional note";
			return (
				(next.editor._tag === "note" && next.editor.pick === msg.pick && next.editor.text === "") ||
				"a no-rec pick did not open its note"
			);
		}
		if (msg.type !== "submit" || prev.editor._tag !== "note") return true;
		const note = prev.editor.text.trim();
		if (saves.length !== 1) return "Enter did not send the optional note";
		const answer = saves[0]?.answer as {_tag: string; pick?: string; note?: string};
		return (
			(answer._tag === "chose" &&
				answer.pick === prev.editor.pick &&
				answer.note === (note || undefined) &&
				Object.hasOwn(answer, "note") === (note !== "")) ||
			"the save changed the optional note"
		);
	},
	// Random Msgs can miss typing and submitting. Exercise both optional-note paths every time.
	[
		{type: "pick", pick: "approve"},
		{type: "submit", key: "Enter", now: NOW},
		{type: "save_ok", value: null},
		{type: "pick", pick: "approve"},
		{type: "note", text: "the second file needs a look"},
		{type: "submit", key: "Enter", now: NOW},
	],
);

/**
 * Property 12: only an accepted answer advances. While a save is out, no second save goes and the
 * editor stays saving; a failed save keeps the ask and the draft, and says why.
 */
const onlyAccepted = every(
	"only an accepted save advances, and a failed one keeps the draft",
	(step) => {
		const {prev, msg, next} = step;
		if (prev.editor._tag !== "saving" || msg.type === "show") return true;
		if (msg.type === "save_ok")
			return next.editor._tag === "reading" && step.cmds.some((c) => c.type === "answered");
		if (msg.type === "save_err")
			return JSON.stringify(next.editor) !== JSON.stringify(prev.draft ?? {_tag: "reading"})
				? "a failed save dropped the draft"
				: next.ask === prev.ask && next.failure === "The ask was withdrawn";
		if (savesOf(step).length > 0) return "a second save went while one was out";
		return next.editor._tag === "saving" || "the editor left saving before the answer came back";
	},
);

/**
 * Property 16: time on screen counts only while focused, active and visible, never runs back,
 * and the evidence parts opened keep their order. A new ask starts its own count.
 */
const focusedTime = every(
	"time counts only while focused, and openings keep their order",
	(step) => {
		const {prev, msg, next} = step;
		if (msg.type === "show" && next.ask.ask !== prev.ask.ask)
			return (
				(next.took.ms === 0 && next.took.opened.length === 0) || "a new ask kept the old count"
			);
		if (next.took.ms < prev.took.ms) return "the time on screen ran back";
		const clock = prev.clock;
		const counting = clock !== undefined && clock.focused && clock.active && clock.visible;
		if (!counting && next.took.ms !== prev.took.ms) return "time counted while out of focus";
		const kept = next.took.opened.slice(0, prev.took.opened.length);
		if (JSON.stringify(kept) !== JSON.stringify(prev.took.opened))
			return "the openings changed order";
		// Only opening counts (review 2, low 2): closing the evidence again adds nothing.
		const closing = msg.type === "open" && msg.name === "evidence" && prev.evidence === true;
		if (msg.type === "open" && !closing)
			return (
				(next.took.opened.length === prev.took.opened.length + 1 &&
					next.took.opened.at(-1) === msg.name) ||
				"an opening was not recorded last"
			);
		return next.took.opened.length === prev.took.opened.length || "an opening came from nowhere";
	},
);

/**
 * Design E (owner, 2026-11-08): "Did this need you?" is offered only once a pick is in hand, never
 * before. A pick is in hand while its note is open, and while that answer saves or comes back
 * refused. Taking the rec saves at once, so it never has a pick in hand.
 */
const pickInHand = (model: Model): boolean =>
	model.editor._tag === "note" || (model.editor._tag === "saving" && model.draft?._tag === "note");

/**
 * Property 17: the mark has three values. Pressing a mark sets it, pressing the selected one
 * clears it, and a save carries it exactly when it is set, false included. Since design E, a
 * press only counts while the marks are offered.
 */
const threeMarks = every(
	"needed stays unmarked, true or false, and a save carries it as it is",
	(step) => {
		const {prev, msg, next} = step;
		for (const save of savesOf(step))
			if (save.needed !== prev.needed || "needed" in save !== (prev.needed !== undefined))
				return "the save changed the mark";
		if (msg.type !== "mark" || prev.editor._tag === "saving" || !pickInHand(prev)) return true;
		if (prev.needed === msg.needed) return !("needed" in next) || "the selected mark did not clear";
		return next.needed === msg.needed || "the mark did not take";
	},
	// Press each mark twice with a pick in hand, on every kind of ask (see markWithAPick).
	[
		{type: "do", value: AskCommand.cases.not.make({})},
		{type: "mark", needed: true},
		{type: "mark", needed: true},
		{type: "do", value: AskCommand.cases.picks.make({})},
		{type: "pick", pick: "approve"},
		{type: "mark", needed: false},
		{type: "mark", needed: false},
	],
);

/**
 * Design E: a mark is set only while a pick is in hand. A press before a pick changes nothing, and
 * a mark goes with its pick (Escape, or the save landing), so no save carries a mark the person
 * could not see.
 */
const markWithAPick = every(
	"needed is set only while a pick is in hand",
	({next}) => next.needed === undefined || pickInHand(next) || "a mark is set with no pick in hand",
	// Mark, then leave the pick, on each kind of ask: n opens a note where a shown rec has one
	// other pick; every pick, then approve, opens one where the rec is hidden or absent.
	[
		{type: "do", value: AskCommand.cases.not.make({})},
		{type: "mark", needed: true},
		{type: "escape"},
		{type: "do", value: AskCommand.cases.picks.make({})},
		{type: "pick", pick: "approve"},
		{type: "mark", needed: false},
		{type: "escape"},
	],
);

/** No answer goes on its own: a save only follows a person's press, never a tick or a focus. */
const noSilentAnswer = every("silence never answers: a save only follows a press", (step) => {
	const pressed = ["do", "pick", "submit"].includes(step.msg.type);
	return pressed || savesOf(step).length === 0 || `${step.msg.type} saved an answer`;
});

const LAWS = [
	honestAnswers,
	choiceNotes,
	onlyAccepted,
	focusedTime,
	threeMarks,
	markWithAPick,
	noSilentAnswer,
];

// ---------------------------------------------------------------- planted mistakes

const real = askMachine.update;
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...askMachine,
	update: {...real, ...update},
});
type Do = Extract<Msg, {type: "do"}>;

const PLANTS: readonly {readonly law: Law; readonly mistake: string; readonly machine: Machine}[] =
	[
		{
			law: honestAnswers,
			mistake: "y reveals a hidden rec and takes it",
			machine: plant({
				do: (s, m) => {
					if ((m as Do).value._tag !== "rec" || s.ask.shows.rec._tag !== "hidden")
						return real.do(s, m);
					const shown = {...s.ask, shows: {...s.ask.shows, rec: DRAFT.rec}};
					const [next, cmds] = real.do({...s, ask: shown}, m);
					return [{...next, ask: s.ask}, cmds];
				},
			}),
		},
		{
			law: choiceNotes,
			mistake: "a no-rec pick sends before the person can leave a note",
			machine: plant({
				pick: (s, m) => {
					const [next, cmds] = real.pick(s, m);
					return s.ask.shows.rec._tag !== "pick" && next.editor._tag === "note"
						? real.submit(next, {type: "submit", key: "Enter", now: NOW})
						: [next, cmds];
				},
			}),
		},
		{
			law: choiceNotes,
			mistake: "Enter discards a chose note",
			machine: plant({
				submit: (s, m) => {
					const [next, cmds] = real.submit(s, m);
					return [
						next,
						cmds.map((c) =>
							c.type === "save" && c.answer._tag === "chose"
								? {...c, answer: {_tag: "chose", pick: c.answer.pick}}
								: c,
						),
					];
				},
			}),
		},
		{
			law: choiceNotes,
			mistake: "Enter invents a blank chose note",
			machine: plant({
				submit: (s, m) => {
					const [next, cmds] = real.submit(s, m);
					return [
						next,
						cmds.map((c) =>
							c.type === "save" && c.answer._tag === "chose"
								? {...c, answer: {...c.answer, note: ""}}
								: c,
						),
					];
				},
			}),
		},
		{
			law: onlyAccepted,
			mistake: "a failed save drops the draft",
			machine: plant({
				save_err: (s, m) => [{...real.save_err(s, m)[0], editor: {_tag: "reading"}}, []],
			}),
		},
		{
			law: focusedTime,
			mistake: "time counts while the ask is out of focus",
			machine: plant({
				tick: (s, m) => [
					{...s, took: {...s.took, ms: s.took.ms + 1}, clock: {...s.clock!, at: m.now}},
					[],
				],
			}),
		},
		{
			law: threeMarks,
			mistake: "pressing the selected mark sets false instead of clearing it",
			machine: plant({
				mark: (s, m) =>
					s.needed === m.needed && s.editor._tag !== "saving"
						? [{...s, needed: false}, []]
						: real.mark(s, m),
			}),
		},
		{
			law: focusedTime,
			mistake: "closing the evidence records it again",
			machine: plant({
				open: (s, m) => {
					const [next, cmds] = real.open(s, m);
					return m.name === "evidence" && s.evidence === true
						? [{...next, took: {...next.took, opened: [...next.took.opened, m.name]}}, cmds]
						: [next, cmds];
				},
			}),
		},
		{
			law: markWithAPick,
			mistake: "a mark before a pick takes (today's marks, drawn before any pick)",
			machine: plant({
				mark: (s, m) => {
					if (s.editor._tag === "saving") return [s, []];
					const {needed: _needed, ...rest} = s;
					return [s.needed === m.needed ? rest : {...rest, needed: m.needed}, []];
				},
			}),
		},
		{
			law: markWithAPick,
			mistake: "Escape closes the note and keeps its mark",
			machine: plant({
				escape: (s, m) => {
					const [next, cmds] = real.escape(s, m);
					return [s.needed === undefined ? next : {...next, needed: s.needed}, cmds];
				},
			}),
		},
		{
			law: noSilentAnswer,
			mistake: "a tick takes the rec",
			machine: plant({
				tick: (s, m) =>
					s.ask.shows.rec._tag === "pick"
						? real.do(s, {type: "do", value: AskCommand.cases.rec.make({}), now: m.now})
						: real.tick(s, m),
			}),
		},
	];

// ---------------------------------------------------------------- the view's laws (design E)

/**
 * What design E reads from the view model, beyond what today's AskView holds. Every field is
 * optional here so this file types on a head that has none of them yet; the laws say which must be
 * there. Design E, picked by the owner on 2026-11-08: one quiet bar, "Your turn", the question,
 * the four actions, then the rec line "Recommended <pick> · NN% sure" and its reason.
 */
type Row = {readonly pick: string; readonly does: string; readonly tag?: string};
type DeskView = {
	/** "Did this need you?" is offered: only once a pick is in hand. */
	readonly marks?: boolean;
	/** The rec line's words: "Recommended approve · 95% sure"; a blind or no-rec ask's never say Recommended. */
	readonly line?: string;
	/** Every pick's row, in the ask's order, only while every pick is open. */
	readonly rows?: readonly Row[];
	readonly note?: {readonly label: string; readonly send: string};
};
type Draw = (model: Model) => DeskView;
const drawn: Draw = (model) => askView(model);

interface ViewLaw {
	readonly name: string;
	readonly check: (draw: Draw) => void;
}
/** A law on the view of every model the real machine reaches, from its real init. */
const everyView = (
	name: string,
	law: (view: DeskView, model: Model) => boolean | string,
	prefix: readonly Msg[] = [],
): ViewLaw => ({
	name,
	check: (draw) => {
		for (const ask of ASKS)
			propertyInvariant(
				askMachine,
				{ticket: 117, ask, now: NOW},
				arbMsgSequence(arbMsg(table()), {prefix, maxLength: 30, size: "max"}),
				((step: AskStep) => law(draw(step.next), step.next)) as never,
				OPTS,
			);
	},
});
// Open every pick on each kind of ask, so the rows are drawn in every run.
const OPEN_PICKS: readonly Msg[] = [{type: "do", value: AskCommand.cases.picks.make({})}];

/** Design E, fix 1: the marks show only after a pick, never before. */
const marksAfterAPick = everyView(
	"the marks are offered exactly while a pick is in hand",
	(view, model) =>
		view.marks === pickInHand(model) ||
		(view.marks === undefined
			? "the view does not say whether the marks are offered"
			: view.marks
				? `the marks are offered while ${model.editor._tag}, before a pick`
				: "the marks are not offered with a pick in hand"),
	[{type: "do", value: AskCommand.cases.not.make({})}],
);

const RECOMMENDED = /\brecommended\b/gi;
const wordsOf = (view: DeskView): readonly string[] => [
	view.line ?? "",
	...(view.rows ?? []).flatMap((r) => [r.pick, r.does, r.tag ?? ""]),
	view.note?.label ?? "",
	view.note?.send ?? "",
];

/**
 * Design E, fix 3: "Recommended" is said once across the whole view for an ask with a shown rec,
 * whether every pick is open or not, and never for a blind or no-rec ask. The line for a shown rec
 * is the fixed format "Recommended <pick> · NN% sure" (sureness unknown: no number).
 */
const recommendedOnce = everyView(
	"Recommended is said once for a shown rec, and never for a blind or no-rec ask",
	(view, model) => {
		if (typeof view.line !== "string") return "the view has no rec line";
		const rec = model.ask.shows.rec;
		const said = wordsOf(view).join(" ").match(RECOMMENDED)?.length ?? 0;
		if (rec._tag !== "pick")
			return said === 0 || `a ${rec._tag} rec's view says Recommended ${said} times`;
		if (said !== 1) return `the view says Recommended ${said} times`;
		const line = view.line.toLowerCase();
		const format =
			rec.sure === null
				? line.startsWith(`recommended ${rec.pick.toLowerCase()}`) && !line.includes("%")
				: line === `recommended ${rec.pick.toLowerCase()} · ${rec.sure}% sure`;
		return format || `the rec line is not the fixed format: ${view.line}`;
	},
	OPEN_PICKS,
);

/** Every pick opens under the bar: its rows, in the ask's order, only while every pick is open. */
const rowsWhileOpen = everyView(
	"every pick's row is drawn, in order, only while every pick is open",
	(view, model) => {
		if (model.editor._tag !== "picks")
			return view.rows === undefined || `rows drawn while ${model.editor._tag}`;
		const rows = view.rows ?? [];
		const picks = model.ask.shows.picks;
		return (
			(rows.length === picks.length &&
				rows.every((r, i) => r.pick === picks[i]?.pick && r.does === picks[i]?.does)) ||
			"the rows are not the ask's picks in order"
		);
	},
	OPEN_PICKS,
);

const VIEW_LAWS = [marksAfterAPick, recommendedOnce, rowsWhileOpen];

const VIEW_PLANTS: readonly {
	readonly law: ViewLaw;
	readonly mistake: string;
	readonly draw: Draw;
}[] = [
	{
		law: marksAfterAPick,
		mistake: "the marks show before a pick (today's view)",
		draw: (model) => ({...drawn(model), marks: true}),
	},
	{
		law: recommendedOnce,
		mistake: "the rec's row repeats the Recommended tag the line already says",
		draw: (model) => {
			const view = drawn(model);
			const rec = model.ask.shows.rec;
			return rec._tag !== "pick" || view.rows === undefined
				? view
				: {
						...view,
						rows: view.rows.map((r) => (r.pick === rec.pick ? {...r, tag: "Recommended"} : r)),
					};
		},
	},
	{
		// The look branch's design E said this for a blind ask.
		law: recommendedOnce,
		mistake: "a blind ask's line says Recommended · Hidden until you pick",
		draw: (model) =>
			model.ask.shows.rec._tag === "hidden"
				? {...drawn(model), line: "Recommended · Hidden until you pick"}
				: drawn(model),
	},
	{
		law: rowsWhileOpen,
		mistake: "the rows stay drawn after Escape closes every pick",
		draw: (model) => ({
			...drawn(model),
			rows: model.ask.shows.picks.map((p) => ({pick: p.pick, does: p.does})),
		}),
	},
];

describe("the shared ask view's laws, design E (askView)", () => {
	it.each(VIEW_LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(drawn);
	});

	it.each(VIEW_PLANTS.map((p) => [p.mistake, p] as const))(
		"the planted mistake %s is caught",
		(_, {law, draw}) => {
			expect(() => law.check(draw)).toThrow();
		},
	);

	it("every view law has a planted mistake", () => {
		expect(VIEW_LAWS.filter((law) => !VIEW_PLANTS.some((p) => p.law === law))).toEqual([]);
	});
});

describe("the shared ask editor's laws (askMachine)", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(askMachine);
	});

	it.each(PLANTS.map((p) => [p.mistake, p] as const))(
		"the planted mistake %s is caught",
		(_, {law, machine}) => {
			expect(() => law.check(machine)).toThrow();
		},
	);

	it("every law has a planted mistake", () => {
		expect(LAWS.filter((law) => !PLANTS.some((p) => p.law === law))).toEqual([]);
	});
});
