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
import {askMachine} from "./ask-window.tsx";

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
		if (msg.type === "open") return next.took.opened.at(-1) === msg.name;
		return next.took.opened.length === prev.took.opened.length || "an opening came from nowhere";
	},
);

/**
 * Property 17: the mark has three values. Pressing a mark sets it, pressing the selected one
 * clears it, and a save carries it exactly when it is set, false included.
 */
const threeMarks = every(
	"needed stays unmarked, true or false, and a save carries it as it is",
	(step) => {
		const {prev, msg, next} = step;
		for (const save of savesOf(step))
			if (save.needed !== prev.needed || "needed" in save !== (prev.needed !== undefined))
				return "the save changed the mark";
		if (msg.type !== "mark" || prev.editor._tag === "saving") return true;
		if (prev.needed === msg.needed) return !("needed" in next) || "the selected mark did not clear";
		return next.needed === msg.needed || "the mark did not take";
	},
);

/** No answer goes on its own: a save only follows a person's press, never a tick or a focus. */
const noSilentAnswer = every("silence never answers: a save only follows a press", (step) => {
	const pressed = ["do", "pick", "submit"].includes(step.msg.type);
	return pressed || savesOf(step).length === 0 || `${step.msg.type} saved an answer`;
});

const LAWS = [honestAnswers, choiceNotes, onlyAccepted, focusedTime, threeMarks, noSilentAnswer];

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
