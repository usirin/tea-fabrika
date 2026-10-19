import {structuralHash} from "@demlik/tea";
import {nameOf} from "../stages/outcome.ts";
import {
	fileNote,
	gatherPack,
	type Review,
	type ReviewCmd,
	review,
} from "../stages/review/machine.ts";
import type {Deviations, Pack} from "../stages/review/pack.ts";
import {noRun, type Settings} from "../stages/review/reviewer.ts";
import type {Form, Row} from "../stages/review/sheet.ts";
import {
	agree,
	broke,
	type Law,
	law,
	type MsgOf,
	type Step,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// The review machine under every order of messages: its world, its laws, and
// one planted mistake per law.
//
// What the builder writes reaches the review machine one way: the pull
// request's text, read into the pack as `deviations`. The reviewer (an agent)
// reads it too, and may grade differently because of it; that is the agent's
// part, and out of reach here. What is checked is the code around the agent:
// given the same ticket and the same form, the review ends the same way
// whatever the builder wrote.

export type AnyReviewMsg = MsgOf<typeof review>;
type Msg = AnyReviewMsg;
const reviewUpdate = stepOf<Review, AnyReviewMsg, ReviewCmd>(review);

export const PR = "P";
export const HEADS = ["A", "B"] as const;
const SETTINGS: Settings = {model: "m", effort: "low", budget: 1};
const CRITERIA = [
	{n: 1, text: "every window opens", checked: false, evidence: null},
	{n: 2, text: "the door locks", checked: false, evidence: null},
] as const;

export const DEVIATIONS: readonly Deviations[] = [
	{state: "none"},
	{state: "listed", text: "criterion 1 is met another way: the painted-shut window stays shut"},
];

const packAt = (head: string, checks: Pack["checks"]["state"], deviations: Deviations): Pack => ({
	pr: PR,
	head,
	replay: false,
	state: "open",
	ticket: {id: "T", link: "closes_it"},
	criteria: [...CRITERIA],
	files: [{path: "a.ts", kind: "review-code"}],
	kinds: ["review-code"],
	diff: "d",
	deviations,
	checks: {state: checks, required: []},
	rules: [],
	rubrics: [{kind: "review-code", text: "r"}],
});

const pass = (n: number): Row => ({n, grade: "pass", where: [], says: "seen", limit: null});
const finding = (n: number) => ({
	kind: "review-code" as const,
	from: {source: "criterion" as const, n},
	fault: `criterion ${n} is not met`,
	at: null,
	proof: "p",
	wants: `criterion ${n} met`,
});

/** The forms a reviewer may hand back. */
export const FORMS: Readonly<Record<string, Form>> = {
	pass: {rows: [pass(1), pass(2)], findings: [], skipped: []},
	"fail 1": {
		rows: [{n: 1, grade: "fail", where: [], says: "stuck shut"}, pass(2)],
		findings: [finding(1)],
		skipped: [],
	},
	"unseen 2": {
		rows: [pass(1), {n: 2, grade: "unseen", says: "no lock in the diff"}],
		findings: [],
		skipped: [],
	},
	"pass with a limit": {
		rows: [
			{n: 1, grade: "pass", where: [], says: "seen", limit: "except the painted-shut one"},
			pass(2),
		],
		findings: [],
		skipped: [],
	},
	"no row for 2": {rows: [pass(1)], findings: [], skipped: []},
};

export interface ReviewWorldOptions {
	readonly heads?: readonly string[];
	/** Which forms the reviewer may hand back. Default: all of {@link FORMS}. */
	readonly forms?: readonly string[];
	readonly echoes?: boolean;
}

const UNKNOWN = {_tag: "unknown" as const};

export function reviewWorld(options: ReviewWorldOptions = {}): World<Review, Msg, ReviewCmd> {
	const heads = options.heads ?? HEADS;
	const forms = (options.forms ?? Object.keys(FORMS)).flatMap((name) => {
		const form = FORMS[name];
		return form === undefined ? [] : [form];
	});
	const packs = heads.flatMap((head) =>
		(["green", "pending", "red"] as const).flatMap((checks) =>
			DEVIATIONS.map((deviations) => packAt(head, checks, deviations)),
		),
	);
	return {
		outside: (s) => {
			const runs = s.phase === "reviewing" ? [s.run, s.run - 1] : [1];
			const waits = "waited" in s ? [s.waited, s.waited - 1] : [0];
			return [
				{
					type: "start",
					ask: {pr: PR, head: null, rubrics: "r"},
					settings: SETTINGS,
				},
				{type: "resume"},
				...heads.flatMap((head): Msg[] => [
					{type: "review_checks", pr: PR, head},
					...waits.map((wait): Msg => ({type: "review_checks_overdue", pr: PR, head, wait})),
					...runs.flatMap((run): Msg[] => [
						...forms.map(
							(form): Msg => ({
								type: "review_reviewed",
								pr: PR,
								head,
								run,
								form,
								ran: noRun,
							}),
						),
						{type: "review_failed", pr: PR, head, run, why: "broke", error: null, ran: noRun},
						{type: "review_note", pr: PR, head, run, note: {title: "t", body: "b", at: null}},
					]),
				]),
			];
		},
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "review_pack":
					return [...packs.map((p) => gatherPack.ok(cmd, p, 0)), gatherPack.err(cmd, UNKNOWN, 0)];
				case "review_file_note":
					return [fileNote.ok(cmd, "kept", 0), fileNote.err(cmd, UNKNOWN, 0)];
			}
		},
		restart: (msg) => msg.type === "resume",
		...(options.echoes === undefined ? {} : {echoes: options.echoes}),
	};
}

type Ended = Extract<Review, {phase: "judging" | "over"}>;
/** The step on which the review's outcome is decided, and that outcome's state. */
const decided = (step: Step<Review, Msg, ReviewCmd>): Ended | null =>
	(step.next.phase === "judging" || step.next.phase === "over") &&
	step.prev.phase !== "judging" &&
	step.prev.phase !== "over"
		? step.next
		: null;
const criteriaOfEnd = (s: Ended) => (s.phase === "over" ? s.report.criteria : s.judgement.criteria);
const headOfEnd = (s: Ended) => (s.phase === "over" ? s.report.head : s.judgement.head);

/** The pack the machine was waiting for: one that comes while it is gathering. */
const lastPack = (memory: Pack | null, step: Step<Review, Msg, ReviewCmd>): Pack | null =>
	step.msg.type === "review_pack_ok" && step.prev.phase === "gathering" ? step.msg.value : memory;

export function reviewLaws<S extends Review>(): readonly Law<S, Msg, ReviewCmd>[] {
	return [
		watched<S, Msg, ReviewCmd, Pack | null>(
			"done only when every criterion passed at the head, with checks green",
			null,
			(memory, step) => {
				const pack = lastPack(memory, step);
				const end = decided(step);
				if (end === null || end.outcome.kind !== "done") return pack;
				const {msg} = step;
				if (msg.type !== "review_reviewed") return broke(`done on ${msg.type}, with no form`);
				const unmet = (pack?.criteria ?? []).filter(
					(c) => !msg.form.rows.some((row) => row.n === c.n && row.grade === "pass"),
				);
				if (unmet.length > 0)
					return broke(
						`done, and criteria ${unmet.map((c) => c.n).join(", ")} have no pass row in the form`,
					);
				if (msg.form.findings.length > 0) return broke("done, and the form has open findings");
				if (pack === null || pack.checks.state !== "green")
					return broke(`done, and the checks were ${pack?.checks.state ?? "never read"}`);
				if (end.outcome.head !== pack.head)
					return broke(`done at ${end.outcome.head}, and the pack was read at ${pack.head}`);
				if (criteriaOfEnd(end).some((c) => c.state !== "met"))
					return broke("done, and a criterion is open");
				return pack;
			},
		),
		law<S, Msg, ReviewCmd>("a form for another head or an old run never counts", (step) => {
			const {msg, prev} = step;
			if (msg.type !== "review_reviewed" && msg.type !== "review_failed") return null;
			if (prev.phase !== "reviewing") return null;
			if (structuralHash(step.next) === structuralHash(prev)) return null;
			if (msg.head !== prev.brief.head || msg.run !== prev.run)
				return `a form from ${msg.head} run ${msg.run} was used for ${prev.brief.head} run ${prev.run}`;
			const end = decided(step);
			if (end !== null && headOfEnd(end) !== prev.brief.head)
				return `the report is about ${headOfEnd(end)}, and ${prev.brief.head} was reviewed`;
			return null;
		}),
		agree<S, Msg, ReviewCmd>(
			"the builder's text never changes a criterion or the outcome",
			(step) => {
				const {msg, prev} = step;
				const end = decided(step);
				if (end === null || msg.type !== "review_reviewed" || prev.phase !== "reviewing")
					return null;
				const {deviations, ...rest} = prev.brief;
				const criteria = criteriaOfEnd(end)
					.map((c) => `${c.n} "${c.text}" ${c.state}`)
					.join(", ");
				return {
					key: structuralHash({brief: rest, form: msg.form, tries: prev.tries, limit: prev.limit}),
					value: `${nameOf(end.outcome)} (${criteria || "no criteria"})`,
					seen: `with deviations ${deviations.state}, the same form`,
				};
			},
		),
		law<S, Msg, ReviewCmd>("a criterion's words are the ticket's", (step) => {
			const end = decided(step);
			// A review that ended with no usable form judged no criterion: there is nothing to compare.
			if (end === null || step.prev.phase !== "reviewing" || end.outcome.kind === "stuck")
				return null;
			const ticket = step.prev.brief.criteria;
			for (const c of criteriaOfEnd(end).filter((c) => c.from === "ticket")) {
				const t = ticket.find((x) => x.n === c.n);
				if (t === undefined || t.text !== c.text) return `criterion ${c.n} reads "${c.text}"`;
			}
			const missing = ticket.filter(
				(t) => !criteriaOfEnd(end).some((c) => c.from === "ticket" && c.n === t.n),
			);
			return missing.length > 0
				? `criteria ${missing.map((t) => t.n).join(", ")} were dropped`
				: null;
		}),
		law<S, Msg, ReviewCmd>("a pass with a named limit leaves the criterion open", (step) => {
			const end = decided(step);
			if (end === null || end.outcome.kind !== "done" || step.msg.type !== "review_reviewed")
				return null;
			const limited = step.msg.form.rows.flatMap((row) =>
				row.grade === "pass" && row.limit !== null ? [`${row.n} ("${row.limit}")`] : [],
			);
			return limited.length > 0
				? `done, and criterion ${limited.join(", ")} passed with a limit`
				: null;
		}),
		law<S, Msg, ReviewCmd>("an ended review sends nothing", (step) =>
			step.prev.phase === "over" && step.cmds.length > 0
				? `${step.cmds.map((c) => c.type).join(", ")} after the review ended`
				: null,
		),
	];
}

export const reviewInit: Review = {phase: "idle"};
export const reviewStep: Update<Review, Msg, ReviewCmd> = reviewUpdate;

export function showReviewMsg(m: Msg): string {
	switch (m.type) {
		case "review_pack_ok":
			return `pack at ${m.value.head}: checks ${m.value.checks.state}, deviations ${m.value.deviations.state}`;
		case "review_reviewed": {
			const name = Object.entries(FORMS).find(
				([, f]) => structuralHash(f) === structuralHash(m.form),
			)?.[0];
			return `form "${name ?? "?"}" from ${m.head} run ${m.run}`;
		}
		case "review_failed":
			return `reviewer ${m.why} at ${m.head} run ${m.run}`;
		case "review_note":
			return `note from ${m.head} run ${m.run}`;
		case "review_checks":
			return `checks settled at ${m.head}`;
		case "review_checks_overdue":
			return `checks clock at ${m.head}, wait ${m.wait}`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

const unseenToPass = (form: Form): Form => ({
	...form,
	rows: form.rows.map((row): Row => (row.grade === "unseen" ? pass(row.n) : row)),
});

/** A criterion nobody could see is taken as met. */
export const unseenIsMet: Update<Review, Msg, ReviewCmd> = (s, m) =>
	m.type === "review_reviewed"
		? reviewUpdate(s, {...m, form: unseenToPass(m.form)})
		: reviewUpdate(s, m);

/** A pass with a named limit is read as a plain pass: the limit is kept as a note, the criterion met. */
export const limitIsAPass: Update<Review, Msg, ReviewCmd> = (s, m) =>
	m.type === "review_reviewed"
		? reviewUpdate(s, {
				...m,
				form: {
					...m.form,
					rows: m.form.rows.map((row): Row => (row.grade === "pass" ? {...row, limit: null} : row)),
				},
			})
		: reviewUpdate(s, m);

/** The run check forgets the head: a form from any head is taken for this one. */
export const takesAnyHead: Update<Review, Msg, ReviewCmd> = (s, m) =>
	m.type === "review_reviewed" && s.phase === "reviewing" && m.run === s.run
		? reviewUpdate(s, {...m, head: s.brief.head})
		: reviewUpdate(s, m);

/** A declared deviation excuses a failed row: the "named limit" pass. */
export const deviationExcuses: Update<Review, Msg, ReviewCmd> = (s, m) => {
	if (
		m.type !== "review_reviewed" ||
		s.phase !== "reviewing" ||
		s.brief.deviations.state !== "listed"
	)
		return reviewUpdate(s, m);
	const form: Form = {
		...m.form,
		rows: m.form.rows.map((row): Row => (row.grade === "fail" ? pass(row.n) : row)),
		findings: m.form.findings.filter((f) => f.from.source !== "criterion"),
	};
	return reviewUpdate(s, {...m, form});
};

/** The report takes a criterion's words from the builder's deviations. */
export const rewordsFromDeviations: Update<Review, Msg, ReviewCmd> = (s, m) => {
	const [next, cmds] = reviewUpdate(s, m);
	if (next.phase !== "over" || s.phase !== "reviewing" || s.brief.deviations.state !== "listed")
		return [next, cmds];
	const text = s.brief.deviations.text;
	const criteria = next.report.criteria.map((c) => (c.n === 1 ? {...c, text} : c));
	return [{...next, report: {...next.report, criteria}}, cmds];
};

/** A restart after the end reads the pack again. */
export const actsAfterTheEnd: Update<Review, Msg, ReviewCmd> = (s, m) =>
	s.phase === "over" && m.type === "resume"
		? [s, [gatherPack({pr: PR, head: null, rubrics: "r"})]]
		: reviewUpdate(s, m);
