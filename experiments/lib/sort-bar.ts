// Sort with a bar for what is worth doing, as experiments 92 and 92b run it:
// the bar's shape and how sort's brief states it, Jev's three questions, and
// the scores both experiments print. Moved out of `92-sort-bar.ts` so 92b reuses
// it; 92's brief and tables come out the same, byte for byte.
//
// Node at the edge, said out loud: `node:fs` to read a bar file.
import {readFileSync} from "node:fs";
import {Schema} from "effect";
import {ROUTES, type Run, type Said, saidOf, type Ticket, type TruthEntry} from "./sort.ts";

// ---------------------------------------------------------------- the bar

const Rule = Schema.Struct({
	id: Schema.String,
	rule: Schema.String,
	example: Schema.Struct({issue: Schema.optional(Schema.Int), what: Schema.String}),
	evidence: Schema.Array(Schema.Union([Schema.Int, Schema.String])),
});
const NoRule = Schema.Struct({
	...Rule.fields,
	reason: Schema.String,
	/** Only the code can show it holds; sort, with no code, uses it only when the ticket says so itself. */
	needsCode: Schema.optional(Schema.Boolean),
});
/** The bar: when a ticket is a no, and the cases that look like a no but are a yes. */
export const Bar = Schema.Struct({
	note: Schema.String,
	no: Schema.Array(NoRule),
	stillYes: Schema.Array(Rule),
});
export type Bar = typeof Bar.Type;
export const readBar = (path: string): Bar =>
	Schema.decodeUnknownSync(Bar)(JSON.parse(readFileSync(path, "utf8")));

/** One bar with another's clauses added after its own. Pure. */
export const withClauses = (base: Bar, more: Bar): Bar => ({
	note: `${base.note} ${more.note}`,
	no: [...base.no, ...more.no],
	stillYes: [...base.stillYes, ...more.stillYes],
});

/**
 * The bar as lines of sort's brief. Pure. `numbers: false` leaves out each
 * example's issue number: on another repo, `#223` would name that repo's
 * ticket, not the one the example is about.
 */
export const barLines = (b: Bar, {numbers = true}: {numbers?: boolean} = {}): string[] => {
	const example = (e: Bar["no"][number]["example"]) =>
		`${numbers && e.issue !== undefined ? `#${e.issue}, ` : ""}${e.what}`;
	return [
		"The repo's bar for what is worth doing. A ticket is a no when one of these holds; give the reason shown:",
		...b.no.map(
			(r) =>
				`- ${r.rule}${r.needsCode === true ? " (only when the ticket itself shows it)" : ""} Reason: "${r.reason}". Example: ${example(r.example)}.`,
		),
		"These are still a yes, even when they look like a no:",
		...b.stillYes.map((r) => `- ${r.rule} Example: ${example(r.example)}.`),
		"When no rule above fits, the ticket is a yes.",
	];
};

// ---------------------------------------------------------------- Jev

/** The three questions, asked of one state in one call. */
export const jevQuestions = {
	dup: {
		type: "choice",
		instructions:
			"`ticket` is a new ticket in a software repo. `earlier` lists every ticket filed before it, open or closed, by number and title. Choose whether the new ticket asks for the same change, or reports the same problem, as one of the earlier tickets.",
		criteria: {
			duplicate: "One earlier ticket asks for the same change or reports the same problem.",
			new: "No earlier ticket asks for the same change or reports the same problem.",
		},
	},
	worth: {
		type: "choice",
		instructions:
			"`ticket` is a new ticket in the repo described in `repo`. `bar` is that repo's bar for what is worth doing: `no` lists when a ticket is a no, `stillYes` lists cases that look like a no but are a yes. Choose whether the ticket is worth doing by that bar.",
		criteria: {
			yes: "No rule in `bar.no` fits the ticket, or a rule in `bar.stillYes` does: it is worth doing.",
			no: "A rule in `bar.no` fits the ticket and no rule in `bar.stillYes` does: it should be closed.",
		},
	},
	next: {
		type: "choice",
		instructions:
			"`ticket` is a new ticket in the repo described in `repo`, and it is worth doing. Choose the one step that has to happen first.",
		criteria: ROUTES,
	},
} as const;

/** What Jev is shown: the same repo note, bar, ticket and earlier titles as Claude. Pure. */
export const jevState = (
	note: string,
	t: Ticket,
	earlier: readonly {n: number; title: string}[],
	b: Bar,
) => ({
	repo: note,
	bar: {
		no: b.no.map((r) => ({rule: r.rule, reason: r.reason, example: r.example.what})),
		stillYes: b.stillYes.map((r) => ({rule: r.rule, example: r.example.what})),
	},
	ticket: {number: t.n, filed: t.createdAt.slice(0, 10), title: t.title, body: t.body},
	earlier: earlier.toReversed().map((e) => `#${e.n} ${e.title}`),
});

const Shares = Schema.Record(Schema.String, Schema.Number);
/** Jev's three answers to one ticket: the share it gave each choice, and how long the call took. */
export const JevRun = Schema.Struct({dup: Shares, worth: Shares, next: Shares, ms: Schema.Number});
export type JevRun = typeof JevRun.Type;

/** Jev's dollars per token, for the estimate and the cost line. */
export const JEV_USD_PER_TOKEN = 0.042 / 1e6;
/** The confidence at or above which an answer would be acted on. */
export const FLOOR = 0.8;
export const top = (p: Readonly<Record<string, number>>): [string, number] =>
	Object.entries(p).sort((x, y) => y[1] - x[1])[0] ?? ["none", 0];
/** Jev's three answers read as one, the way sort's are: a duplicate, a no, or a route. */
export const jevSaid = (r: JevRun): Said => {
	if (top(r.dup)[0] === "duplicate") return "dup";
	if (top(r.worth)[0] === "no") return "no";
	return top(r.next)[0] as Said;
};

// ---------------------------------------------------------------- the scores

export type Pool = Record<string, Run[]>;
export type JevPool = Record<string, JevRun[]>;
export const pct = (a: number, b: number) =>
	b === 0 ? "-" : `${a} of ${b} (${Math.round((100 * a) / b)}%)`;
export const yesNo = (s: Said | null) =>
	s === null ? null : s === "no" || s === "dup" ? "no" : "yes";
export const isRoute = (s: Said) => s === "plan" || s === "ruling" || s === "research";
export const median = (xs: number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

export type Answer = {n: number; i: number; said: Said | null; run: Run};

/** The scores the question asks for, against one answer key. */
export function scoring(truth: Readonly<Record<string, TruthEntry>>) {
	/** The tickets triage really closed as not worth doing: a no that is not a duplicate. */
	const realNo = (n: number) => truth[n]?.next === "no";
	const answersOf = (pool: Pool, tickets: readonly number[]): Answer[] =>
		tickets.flatMap((n) =>
			(pool[n] ?? []).map((run, i) => ({
				n,
				i,
				run,
				said: run.answer === null ? null : saidOf(run.answer.sort),
			})),
		);
	/** Right by `next`. A duplicate is right only when it names the right earlier ticket. */
	const right = (a: Answer) => {
		const want = truth[a.n]?.next;
		if (a.said !== want) return false;
		if (want !== "dup") return true;
		const s = a.run.answer?.sort;
		return s?.answer === "no" && s.duplicateOf === truth[a.n]?.dupOf;
	};
	const scores = (pool: Pool, tickets: readonly number[]) => {
		const as = answersOf(pool, tickets);
		const yes = as.filter((a) => isRoute(truth[a.n]?.next as Said));
		const nos = as.filter((a) => realNo(a.n));
		const ticketsRun = tickets.filter((n) => (pool[n]?.length ?? 0) >= 2);
		const stable = ticketsRun.filter((n) => {
			const s = answersOf(pool, [n]).map((a) => a.said);
			return s.every((x) => x === s[0]);
		});
		return {
			answers: as.length,
			yesNo: pct(
				as.filter((a) => yesNo(a.said) === yesNo(truth[a.n]?.next as Said)).length,
				as.length,
			),
			noRecall: pct(nos.filter((a) => a.said === "no" || a.said === "dup").length, nos.length),
			falseNo: pct(yes.filter((a) => a.said === "no" || a.said === "dup").length, yes.length),
			route: pct(yes.filter(right).length, yes.length),
			routeWhenYes: pct(
				yes.filter(right).length,
				yes.filter((a) => a.said !== null && isRoute(a.said)).length,
			),
			dup: pct(
				as.filter((a) => truth[a.n]?.next === "dup" && right(a)).length,
				as.filter((a) => truth[a.n]?.next === "dup").length,
			),
			stable: pct(stable.length, ticketsRun.length),
			usd: as.reduce((s, a) => s + a.run.usd, 0),
		};
	};
	const show = (title: string, s: ReturnType<typeof scores>) =>
		console.log(
			`${title}\n  answers ${s.answers}\n  yes/no right ${s.yesNo}\n  real "no" closed ${s.noRecall}\n  false no on a real yes ${s.falseNo}\n  route right on real yeses ${s.route}\n  route right when it said yes ${s.routeWhenYes}\n  duplicates right ${s.dup}\n  same answer both runs ${s.stable}\n  cost $${s.usd.toFixed(2)}`,
		);
	return {realNo, answersOf, right, scores, show};
}

/** One Jev answer beside Claude's answer to the same ticket in the same run. */
export type JevPair = {n: number; i: number; j: JevRun; said: Said; jev: Said};

/** Jev's answers paired with Claude's, run by run, where Claude answered. */
export const jevPairs = (claude: Pool, jev: JevPool, tickets: readonly number[]): JevPair[] =>
	tickets.flatMap((n) =>
		(jev[n] ?? []).flatMap((j, i) => {
			const c = claude[n]?.[i];
			const said = c?.answer === null || c === undefined ? null : saidOf(c.answer.sort);
			return said === null ? [] : [{n, i, j, said, jev: jevSaid(j)}];
		}),
	);

/** Print how Jev agrees with Claude, field by field, and against the answer key. */
export function showJevAgainstClaude(
	title: string,
	pairs: readonly JevPair[],
	truth: Readonly<Record<string, TruthEntry>>,
) {
	const realNo = (n: number) => truth[n]?.next === "no";
	const field = (
		name: string,
		keep: (p: JevPair) => boolean,
		jevOf: (p: JevPair) => [string, number],
		claudeOf: (p: JevPair) => string,
	) => {
		const ps = pairs.filter(keep);
		const sure = ps.filter((p) => jevOf(p)[1] >= FLOOR);
		const same = (p: JevPair) => jevOf(p)[0] === claudeOf(p);
		console.log(
			`  ${name}: agree ${pct(ps.filter(same).length, ps.length)}; at ${FLOOR} or above ${pct(sure.filter(same).length, sure.length)} (${pct(sure.length, ps.length)} clear the floor)`,
		);
	};
	console.log(title);
	field(
		"dup",
		() => true,
		(p) => top(p.j.dup),
		(p) => (p.said === "dup" ? "duplicate" : "new"),
	);
	field(
		"yes/no (neither said dup)",
		(p) => p.said !== "dup" && p.jev !== "dup",
		(p) => top(p.j.worth),
		(p) => (p.said === "no" ? "no" : "yes"),
	);
	field(
		"next (both said yes)",
		(p) => isRoute(p.said) && isRoute(p.jev),
		(p) => top(p.j.next),
		(p) => p.said,
	);
	console.log(
		`  whole answer: agree ${pct(pairs.filter((p) => p.jev === p.said).length, pairs.length)}`,
	);
	const claudeNo = pairs.filter((p) => p.said === "no");
	console.log(
		`  where Claude said no (not a duplicate): Jev said no ${pct(claudeNo.filter((p) => p.jev === "no").length, claudeNo.length)}; where Jev said no: Claude said no ${pct(pairs.filter((p) => p.jev === "no" && p.said === "no").length, pairs.filter((p) => p.jev === "no").length)}`,
	);
	const jevAnswers = pairs.map((p) => ({n: p.n, said: p.jev}));
	console.log(
		`  Jev right by \`next\`: ${pct(jevAnswers.filter((a) => a.said === truth[a.n]?.next).length, jevAnswers.length)}; real "no" closed ${pct(jevAnswers.filter((a) => realNo(a.n) && (a.said === "no" || a.said === "dup")).length, jevAnswers.filter((a) => realNo(a.n)).length)}; false no on a real yes ${pct(jevAnswers.filter((a) => isRoute(truth[a.n]?.next as Said) && (a.said === "no" || a.said === "dup")).length, jevAnswers.filter((a) => isRoute(truth[a.n]?.next as Said)).length)}`,
	);
	console.log("  where they differ:");
	for (const p of pairs.filter((x) => x.jev !== x.said)) {
		console.log(
			`    #${p.n} run ${p.i + 1}: Claude ${p.said}, Jev ${p.jev} (dup ${top(p.j.dup)[1]}, worth ${JSON.stringify(p.j.worth)}, next ${JSON.stringify(p.j.next)}); really ${truth[p.n]?.next}`,
		);
	}
}
