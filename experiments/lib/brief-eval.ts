// Testing an agent's brief the tested way (experiment 163): the pieces a brief-lab program can use as
// they are. Every piece is plain data with an Effect Schema, or a pure function, or one service.
//
//   Case, LabelledSet   one labelled case: id, source, kind, the right answer, a short why
//   Split               the set cut into an open half and a locked half, by a fixed seed, per kind
//   Brief               a brief file: its id, its text, its close rules, a hash of the text
//   Bar                 the owner's pass bar: lines over the summary's numbers, proposed or approved
//   RunRecord           one answer to one case: could become a ledger fact as it is
//   Sorter              the service that answers one case under one brief on one model; a fake
//                       gives fixed answers, so a program over it costs $0
//   score, summarize    many cases through the Sorter, then the numbers, with 95% intervals
//
// Node at the edge, said out loud: `node:crypto` for the brief's hash.
import {createHash} from "node:crypto";
import {Context, Effect, Layer, Schema} from "effect";
import {shuffled} from "./review-rounds.ts";

// ---------------------------------------------------------------- the labelled set

/** What a case is, by how it was found. The split keeps each kind's share in both halves. */
export const KINDS = [
	"hard-no",
	"easy-no",
	"duplicate",
	"hard-yes",
	"built",
	"built-random",
	"security",
] as const;
export const Kind = Schema.Literals(KINDS);
export type Kind = typeof Kind.Type;

/** The yes-or-no question: does triage close the ticket, or keep it open? */
export const Verdict = Schema.Literals(["close", "keep"]);
export type Verdict = typeof Verdict.Type;

export const Case = Schema.Struct({
	/** `kamp-us/phoenix#7318` */
	id: Schema.String,
	repo: Schema.String,
	n: Schema.Int,
	/** The experiment and file the label comes from: `92b-truth.json`. */
	source: Schema.String,
	kind: Kind,
	right: Verdict,
	/** For a duplicate, the earlier ticket. */
	of: Schema.NullOr(Schema.Int),
	why: Schema.String,
});
export type Case = typeof Case.Type;

export const LabelledSet = Schema.Struct({
	note: Schema.String,
	/** Sources looked at and left out, each with its reason. */
	left: Schema.Array(Schema.Struct({source: Schema.String, why: Schema.String})),
	cases: Schema.Array(Case),
});
export type LabelledSet = typeof LabelledSet.Type;

/** `exam`: a fresh set, scored once per brief and model (part 3). */
export const Half = Schema.Literals(["open", "locked", "exam"]);
export type Half = typeof Half.Type;

export const Split = Schema.Struct({
	seed: Schema.Int,
	note: Schema.String,
	open: Schema.Array(Schema.String),
	locked: Schema.Array(Schema.String),
});
export type Split = typeof Split.Type;

/**
 * Each kind shuffled with `seed`, its first half (rounded down) open, the rest locked. Pure: the same
 * set and seed give the same split.
 */
export function splitOf(set: LabelledSet, seed: number, note: string): Split {
	const open: string[] = [];
	const locked: string[] = [];
	for (const kind of KINDS) {
		const ids = set.cases
			.filter((c) => c.kind === kind)
			.map((c) => c.id)
			.toSorted();
		const mixed = shuffled(ids, seed);
		const cut = Math.floor(mixed.length / 2);
		open.push(...mixed.slice(0, cut));
		locked.push(...mixed.slice(cut));
	}
	return {seed, note, open, locked};
}

// ---------------------------------------------------------------- the brief

export const Brief = Schema.Struct({
	id: Schema.String,
	/** The first 12 hex digits of the text's sha256: a changed brief is a new version. */
	hash: Schema.String,
	text: Schema.String,
	/** The close rules, from its `## close: <rule>` headings, in order. */
	rules: Schema.Array(Schema.String),
	/** `read`: the model gets the code at the ticket's commit, read-only. `none`: the text alone. */
	code: Schema.Literals(["none", "read"]),
});
export type Brief = typeof Brief.Type;

/**
 * A brief file: `---\nid: <id>\n---` then the text, with an optional `code: read` line after the id.
 * The hash covers the text and the code line, so the same text with code is a new version. Pure.
 */
export function briefOf(file: string): Brief {
	const m = /^---\nid: ([\w.-]+)\n(?:code: (read)\n)?---\n([\s\S]*)$/.exec(file);
	if (m === null) throw new Error("a brief starts with ---, id: <id>, an optional code: read, ---");
	const [, id = "", read, body = ""] = m;
	const text = body.trim();
	const code = read === "read" ? "read" : "none";
	const rules = [...text.matchAll(/^## close: ([\w-]+)$/gm)].map((r) => r[1] ?? "");
	if (rules.length === 0) throw new Error(`brief ${id} has no "## close: <rule>" heading`);
	// A brief with no code line hashes its text alone, as v1 to v3 did, so their saved answers still match.
	const hashed = code === "none" ? text : `code: read\n${text}`;
	return {
		id,
		hash: createHash("sha256").update(hashed).digest("hex").slice(0, 12),
		text,
		rules,
		code,
	};
}

/** The answer a brief asks for: a close names one of the brief's own rules. */
export const answerOf = (brief: Brief) =>
	Schema.Struct({
		triage: Schema.Union([
			Schema.Struct({
				answer: Schema.Literal("close"),
				rule: Schema.Literals(brief.rules),
				of: Schema.NullOr(Schema.Int),
				why: Schema.String,
			}),
			Schema.Struct({answer: Schema.Literal("keep"), why: Schema.String}),
		]),
	});
export type Answer = {
	readonly triage:
		| {
				readonly answer: "close";
				readonly rule: string;
				readonly of: number | null;
				readonly why: string;
		  }
		| {readonly answer: "keep"; readonly why: string};
};

// ---------------------------------------------------------------- one answer, as a record

export const MODELS = ["opus", "sol"] as const;
export const Model = Schema.Literals(MODELS);
export type Model = typeof Model.Type;

export const Tokens = Schema.Struct({
	input: Schema.Number,
	cached: Schema.Number,
	output: Schema.Number,
});

/** One answer to one case. Plain data: the shape a ledger fact could take. */
export const RunRecord = Schema.Struct({
	case: Schema.String,
	half: Half,
	brief: Schema.String,
	hash: Schema.String,
	model: Model,
	/** The model the harness reported: `claude-opus-5-5`, `gpt-6.1-sol`. */
	modelId: Schema.String,
	run: Schema.Int,
	said: Schema.NullOr(Verdict),
	rule: Schema.NullOr(Schema.String),
	of: Schema.NullOr(Schema.Int),
	why: Schema.NullOr(Schema.String),
	/** null when there was no answer. */
	right: Schema.NullOr(Schema.Boolean),
	/** Dollars, where the harness reports them; null on the ChatGPT plan. */
	usd: Schema.NullOr(Schema.Number),
	ms: Schema.Number,
	tokens: Tokens,
	error: Schema.NullOr(Schema.String),
	at: Schema.String,
	/**
	 * A brief that reads code: the commit read, how many reads and searches it made, and on opus the
	 * conversation's size at its last turn (`tokens` counts every turn's input again).
	 */
	code: Schema.optional(
		Schema.Struct({
			at: Schema.String,
			reads: Schema.Number,
			context: Schema.optional(Schema.Number),
		}),
	),
});
export type RunRecord = typeof RunRecord.Type;

/** What a Sorter hands back for one call, before it is scored. */
export interface Said {
	readonly answer: Answer | null;
	readonly modelId: string;
	readonly usd: number | null;
	readonly ms: number;
	readonly tokens: typeof Tokens.Type;
	readonly error: string | null;
	readonly code?: {readonly at: string; readonly reads: number; readonly context?: number};
}

/** Answers one case under one brief on one model. The live one calls a model; the fake does not. */
export class Sorter extends Context.Service<
	Sorter,
	{readonly sort: (brief: Brief, model: Model, c: Case) => Effect.Effect<Said>}
>()("exp-163/Sorter") {}

/** A Sorter that answers from a table and calls no model: for tests and for a program's dry run. */
export const fakeSorter = (
	answers: Readonly<Record<string, Answer["triage"]>>,
): Layer.Layer<Sorter> =>
	Layer.succeed(
		Sorter,
		Sorter.of({
			sort: (_brief, _model, c) => {
				const a = answers[c.id];
				return Effect.succeed({
					answer: a === undefined ? null : {triage: a},
					modelId: "fake",
					usd: 0,
					ms: 0,
					tokens: {input: 0, cached: 0, output: 0},
					error: a === undefined ? "the fake has no answer for this case" : null,
				});
			},
		}),
	);

/** One Sorter answer as a record. Pure but for `at`, which the caller passes. */
export function recordOf(
	c: Case,
	half: Half,
	brief: Brief,
	model: Model,
	run: number,
	s: Said,
	at: string,
): RunRecord {
	const t = s.answer?.triage ?? null;
	return {
		case: c.id,
		half,
		brief: brief.id,
		hash: brief.hash,
		model,
		modelId: s.modelId,
		run,
		said: t?.answer ?? null,
		rule: t?.answer === "close" ? t.rule : null,
		of: t?.answer === "close" ? t.of : null,
		why: t?.why ?? null,
		right: t === null ? null : t.answer === c.right,
		usd: s.usd,
		ms: s.ms,
		tokens: s.tokens,
		error: s.error,
		at,
		...(s.code === undefined ? {} : {code: s.code}),
	};
}

export interface Job {
	readonly brief: Brief;
	readonly model: Model;
	readonly cases: readonly Case[];
	readonly half: Half;
	/** Answers wanted per case. */
	readonly runs: number;
	/** Records already held, so a stopped job goes on where it was. */
	readonly have: readonly RunRecord[];
	readonly concurrency: number;
	/** Called after each answer, to save it; and asked before each call whether to stop (a spend cap). */
	readonly kept: (r: RunRecord) => Effect.Effect<void>;
	readonly stop: () => boolean;
}

/** Every case of a job up to its runs, through the Sorter. The new records, in the order they came. */
export const score = (job: Job): Effect.Effect<readonly RunRecord[], never, Sorter> =>
	Effect.gen(function* () {
		const sorter = yield* Sorter;
		const held = (id: string) =>
			job.have.filter(
				(r) =>
					r.case === id &&
					r.brief === job.brief.id &&
					r.hash === job.brief.hash &&
					r.model === job.model,
			).length;
		const calls = job.cases.flatMap((c) =>
			Array.from({length: Math.max(0, job.runs - held(c.id))}, (_, i) => ({
				c,
				run: held(c.id) + i + 1,
			})),
		);
		const out: RunRecord[] = [];
		yield* Effect.forEach(
			calls,
			({c, run}) =>
				job.stop()
					? Effect.void
					: sorter.sort(job.brief, job.model, c).pipe(
							Effect.map((s) =>
								recordOf(c, job.half, job.brief, job.model, run, s, new Date().toISOString()),
							),
							Effect.tap((r) => Effect.sync(() => out.push(r))),
							Effect.flatMap(job.kept),
						),
			{concurrency: job.concurrency, discard: true},
		);
		return out;
	});

// ---------------------------------------------------------------- the numbers

/** Wilson's 95% interval for k of n, as fractions. Pure. */
export function wilson(k: number, n: number): readonly [number, number] {
	if (n === 0) return [0, 1];
	const z = 1.96;
	const p = k / n;
	const mid = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
	const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
	return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

export const Count = Schema.Struct({
	k: Schema.Int,
	n: Schema.Int,
	lo: Schema.Number,
	hi: Schema.Number,
});
export type Count = typeof Count.Type;
const countOf = (k: number, n: number): Count => {
	const [lo, hi] = wilson(k, n);
	return {k, n, lo, hi};
};

/** A brief's numbers on one model. Every share has its 95% interval. */
export const Summary = Schema.Struct({
	/** Built tickets (every kind whose right answer is keep) closed at least once, on tickets. */
	badClose: Count,
	/** The same, on answers. */
	badCloseAnswers: Count,
	/** Security tickets closed at least once. */
	securityClosed: Count,
	/** Hard no's: answers that closed. */
	hardNoClosed: Count,
	/** Every case whose right answer is close (no and duplicate): answers that closed. */
	noClosed: Count,
	/** Close cases kept in at least one run, on tickets: the missed no's. */
	missedNo: Count,
	/** Tickets with two or more answers that gave the same verdict every time. */
	agreement: Count,
	/** Answers with no verdict. */
	none: Schema.Int,
	usd: Schema.Number,
});
export type Summary = typeof Summary.Type;

/** The numbers of one brief and model over `cases`, from its records. Pure. */
export function summarize(cases: readonly Case[], records: readonly RunRecord[]): Summary {
	const of = (c: Case) => records.filter((r) => r.case === c.id);
	const answered = (c: Case) => of(c).filter((r) => r.said !== null);
	const ran = cases.filter((c) => answered(c).length > 0);
	const closedOnce = (c: Case) => answered(c).some((r) => r.said === "close");
	const keptOnce = (c: Case) => answered(c).some((r) => r.said === "keep");
	const keep = ran.filter((c) => c.right === "keep");
	const close = ran.filter((c) => c.right === "close");
	const closes = (cs: readonly Case[]) =>
		cs.flatMap(answered).filter((r) => r.said === "close").length;
	const answers = (cs: readonly Case[]) => cs.flatMap(answered).length;
	const security = keep.filter((c) => c.kind === "security");
	const hard = close.filter((c) => c.kind === "hard-no");
	const twice = ran.filter((c) => answered(c).length > 1);
	return {
		badClose: countOf(keep.filter(closedOnce).length, keep.length),
		badCloseAnswers: countOf(closes(keep), answers(keep)),
		securityClosed: countOf(security.filter(closedOnce).length, security.length),
		hardNoClosed: countOf(closes(hard), answers(hard)),
		noClosed: countOf(closes(close), answers(close)),
		missedNo: countOf(close.filter(keptOnce).length, close.length),
		agreement: countOf(
			twice.filter((c) => new Set(answered(c).map((r) => r.said)).size === 1).length,
			twice.length,
		),
		none: cases.flatMap(of).filter((r) => r.said === null).length,
		usd: cases.flatMap(of).reduce((s, r) => s + (r.usd ?? 0), 0),
	};
}

// ---------------------------------------------------------------- the bar

/** The numbers a bar line may name: the shares of a Summary. */
export const METRICS = [
	"badClose",
	"badCloseAnswers",
	"securityClosed",
	"hardNoClosed",
	"noClosed",
	"missedNo",
	"agreement",
] as const;
export const BarLine = Schema.Struct({
	metric: Schema.Literals(METRICS),
	/** `max`: the share must be at most `value`; `min`: at least. On the point share, not the interval. */
	is: Schema.Literals(["max", "min"]),
	value: Schema.Number,
	why: Schema.String,
});
export const Bar = Schema.Struct({
	/** Only an approved bar unlocks the locked half. */
	status: Schema.Literals(["proposed", "approved"]),
	approved: Schema.NullOr(Schema.Struct({by: Schema.String, on: Schema.String})),
	note: Schema.String,
	lines: Schema.Array(BarLine),
});
export type Bar = typeof Bar.Type;

/** Each bar line against a summary: its share and whether it passes. Pure. */
export const verdictOf = (bar: Bar, s: Summary) =>
	bar.lines.map((l) => {
		const c = s[l.metric];
		const share = c.n === 0 ? Number.NaN : c.k / c.n;
		return {...l, share, pass: c.n > 0 && (l.is === "max" ? share <= l.value : share >= l.value)};
	});

// ---------------------------------------------------------------- the exam (part 3)

/** A labelled set's id: the first 12 hex digits of its cases' sha256. Pure. */
export const setHashOf = (set: LabelledSet): string =>
	createHash("sha256")
		.update(JSON.stringify(Schema.encodeSync(LabelledSet)(set).cases))
		.digest("hex")
		.slice(0, 12);

/** One brief hash and model on the exam: the set it started on, and when it finished. */
export const ExamEntry = Schema.Struct({
	brief: Schema.String,
	hash: Schema.String,
	model: Model,
	set: Schema.String,
	started: Schema.String,
	/** null while it runs or after it stopped part way: it may go on, on the same set only. */
	done: Schema.NullOr(Schema.String),
});
export type ExamEntry = typeof ExamEntry.Type;

/** Every exam taken: who took it, and every answer. One file, kept apart from tuning's. */
export const ExamBook = Schema.Struct({
	entries: Schema.Array(ExamEntry),
	records: Schema.Array(RunRecord),
});
export type ExamBook = typeof ExamBook.Type;

/**
 * Whether one brief hash and model may sit the exam on this set. Each gets one shot: a finished
 * exam is never run again, on any set. A run that stopped part way goes on, on the same set. Pure.
 */
export function examGate(
	book: ExamBook,
	bar: Bar,
	brief: Brief,
	model: Model,
	set: string,
): {readonly go: "start" | "resume"} | {readonly go: "refuse"; readonly why: string} {
	if (bar.status !== "approved") return {go: "refuse", why: "the exam's bar is not approved"};
	const mine = book.entries.find(
		(e) => e.brief === brief.id && e.hash === brief.hash && e.model === model,
	);
	if (mine === undefined) return {go: "start"};
	if (mine.done !== null)
		return {
			go: "refuse",
			why: `${brief.id} (${brief.hash}) on ${model} sat the exam on ${mine.done.slice(0, 10)}: it is scored once`,
		};
	if (mine.set !== set)
		return {
			go: "refuse",
			why: `${brief.id} (${brief.hash}) on ${model} started on set ${mine.set}, not ${set}`,
		};
	return {go: "resume"};
}

export interface ExamJob {
	readonly book: ExamBook;
	readonly bar: Bar;
	readonly brief: Brief;
	readonly model: Model;
	readonly set: LabelledSet;
	readonly runs: number;
	readonly concurrency: number;
	/** Called with the whole book after each change, to save it. */
	readonly save: (book: ExamBook) => Effect.Effect<void>;
	readonly stop: () => boolean;
	readonly now: () => string;
}

/**
 * One brief on one model, once, on a fresh set, against its own bar. It refuses as `examGate` says,
 * saves every answer as it comes, marks the entry done only when every case has its runs, and then
 * scores. A stopped exam gives `verdict: null` and may go on later.
 */
export const exam = (job: ExamJob) =>
	Effect.gen(function* () {
		const set = setHashOf(job.set);
		const gate = examGate(job.book, job.bar, job.brief, job.model, set);
		if (gate.go === "refuse") return {refused: gate.why, verdict: null, summary: null} as const;
		let book: ExamBook =
			gate.go === "start"
				? {
						...job.book,
						entries: [
							...job.book.entries,
							{
								brief: job.brief.id,
								hash: job.brief.hash,
								model: job.model,
								set,
								started: job.now(),
								done: null,
							},
						],
					}
				: job.book;
		yield* job.save(book);
		const mine = (r: RunRecord) =>
			r.brief === job.brief.id && r.hash === job.brief.hash && r.model === job.model;
		yield* score({
			brief: job.brief,
			model: job.model,
			cases: job.set.cases,
			half: "exam",
			runs: job.runs,
			// A call with no answer is kept in the book but asked again, so one failed call cannot sink the exam.
			have: book.records.filter((r) => mine(r) && r.said !== null),
			concurrency: job.concurrency,
			kept: (r) =>
				Effect.suspend(() => {
					book = {...book, records: [...book.records, r]};
					return job.save(book);
				}),
			stop: job.stop,
		});
		const records = book.records.filter(mine);
		const complete = job.set.cases.every(
			(c) => records.filter((r) => r.case === c.id && r.said !== null).length >= job.runs,
		);
		if (!complete) return {refused: null, verdict: null, summary: null} as const;
		book = {
			...book,
			entries: book.entries.map((e) =>
				e.brief === job.brief.id && e.hash === job.brief.hash && e.model === job.model
					? {...e, done: job.now()}
					: e,
			),
		};
		yield* job.save(book);
		const summary = summarize(job.set.cases, records);
		return {refused: null, verdict: verdictOf(job.bar, summary), summary} as const;
	});
