import type {Writer} from "@kampus/fabrika-old";
import type {Entry, Fact, FactOf} from "@kampus/pipeline/tickets/ticket";

// Ticket 117's shape, made up for the ticket view's tests (ticket 141, plan section 4, E1): ids,
// times and tokens are made up, the shape is the real ticket's. Today's version. Three lanes, the
// first stuck on red tests, a restart 18 h 30 min later, two asks in the second lane, one code step
// in the third.
//
//   lane 1   sort (claude, billed $0.03), plan (astra) asks, exam, test_writer (astra),
//            build (sol, $0.04 list), exam_merge (code) stuck: tests red          6 steps, 1 wait
//   lane 2   restarted from plan; plan (astra) asks, exam (astra) asks, exam_merge (code)
//                                                                                   3 steps, 2 waits
//   lane 3   exam_merge (code)                                                     1 step
//
// The waits: 71 s, 97 s and 121 s, so 4 min 49 s on you. gpt-6-astra's list price is OpenAI's
// pricing page, read 2026-11-02, standard tier, up to 272K input: $10 in, $1 cached, $50 out per
// 1M tokens (https://developers.openai.com/api/docs/pricing). Each astra end says `listUsd: null`,
// as ticket 117's do, written before the row was in the table: the price comes back from the tokens.
// The doubt the price keeps: a step's tokens are its totals, never one request's size, so the
// long-context rate can never be told apart. The short-context rate is the floor.

export const SEC = 1_000;
export const MIN = 60 * SEC;
/** Lane 1's first start: a made-up afternoon. */
export const T0 = Date.UTC(2026, 9, 30, 16, 26, 0);
export const LANE_1 = "a1".repeat(16);
export const LANE_2 = "b2".repeat(16);
export const LANE_3 = "c3".repeat(16);

const lane: Writer = {kind: "agent", id: "lane", for: "owner"};
const owner: Writer = {kind: "user", id: "owner"};

/** gpt-6-astra at its list price, short context, written out so the test pins the rates. */
export const astra = (input: number, cached: number, output: number): number =>
	(10 * (input - cached) + 1 * cached + 50 * output) / 1_000_000;

type Runner = {readonly model: string; readonly harness: string} | null;
type Outcome = FactOf<"ended">["outcome"];
const ASTRA: Runner = {model: "gpt-6-astra", harness: "codex"};
const SOL: Runner = {model: "gpt-6.1-sol", harness: "codex"};
const CLAUDE: Runner = {model: "claude-made-up-4", harness: "claude"};

/** Ticket 117's shape, with `astraAs` as the model each astra step names. */
const shapeOf = (astraAs: Runner) => {
	const facts: [number, Writer, Fact][] = [];
	const add = (at: number, by: Writer, fact: Fact) => {
		facts.push([at, by, fact]);
		return at;
	};
	const who = (r: Runner) => (r === null ? {} : {model: r.model, harness: r.harness});
	const step = (o: {
		readonly run: string;
		readonly stage: string;
		readonly trace: string;
		readonly runner: Runner;
		readonly from: number;
		readonly took: number;
		readonly outcome: Outcome;
		readonly tokens?: readonly [number, number, number];
		readonly listUsd?: number | null;
		readonly billed?: number | null;
	}) => {
		const [input, cached, output] = o.tokens ?? [0, 0, 0];
		add(o.from, lane, {
			type: "started",
			run: o.run,
			stage: o.stage,
			task: null,
			log: null,
			trace: o.trace,
			...who(o.runner),
		});

		if (o.runner !== null) {
			add(o.from + 1, lane, {type: "session", run: o.run, id: `s-${o.run}`});
		}

		const usd = o.runner?.harness === "claude" ? (o.billed ?? 0) : (o.listUsd ?? 0);
		return add(o.from + o.took, lane, {
			type: "ended",
			run: o.run,
			stage: o.stage,
			outcome: o.outcome,
			usd,
			input,
			output,
			turns: 3,
			cached,
			...(o.listUsd === undefined ? {} : {listUsd: o.listUsd}),
			...(o.billed === undefined ? {} : {billed: o.billed}),
			...who(o.runner),
		});
	};
	const ask = (o: {
		readonly ask: string;
		readonly what: string;
		readonly trace: string;
		readonly at: number;
		readonly waited: number;
		readonly pick: string;
	}) => {
		add(o.at, lane, {
			type: "asked",
			ask: o.ask,
			what: o.what,
			picks: [o.pick, "no"],
			trace: o.trace,
		});
		return add(o.at + o.waited, owner, {type: "answered", ask: o.ask, pick: o.pick, note: "ok"});
	};
	const send = (to: string, why: string): Outcome => ({kind: "send", to, why});

	add(T0 - 3 * 24 * 60 * MIN, owner, {
		type: "filed",
		title: "The map should take a ticket on a pipe",
		body: "",
	});
	// Lane 1.
	let t = step({
		run: "r-sort-1",
		stage: "sort",
		trace: LANE_1,
		runner: CLAUDE,
		from: T0,
		took: 2 * MIN,
		outcome: send("plan", "sorted"),
		tokens: [20_000, 0, 1_000],
		listUsd: null,
		billed: 0.03,
	});
	t = step({
		run: "r-plan-2",
		stage: "plan",
		trace: LANE_1,
		runner: astraAs,
		from: t + SEC,
		took: 6 * MIN,
		outcome: {kind: "ask", who: "owner", for: "approval"},
		tokens: [100_000, 60_000, 5_000],
		listUsd: null,
	});
	t = ask({
		ask: "a-approve-2",
		what: "Do you approve plan version 1?",
		trace: LANE_1,
		at: t + SEC,
		waited: 71 * SEC,
		pick: "approve",
	});
	t = step({
		run: "r-exam-3",
		stage: "exam",
		trace: LANE_1,
		runner: astraAs,
		from: t + SEC,
		took: 4 * MIN,
		outcome: send("test_writer", "examined"),
		tokens: [50_000, 20_000, 2_000],
		listUsd: null,
	});
	t = step({
		run: "r-test_writer-4",
		stage: "test_writer",
		trace: LANE_1,
		runner: astraAs,
		from: t + SEC,
		took: 8 * MIN,
		outcome: send("build", "tests written"),
		tokens: [80_000, 40_000, 8_000],
		listUsd: null,
	});
	t = step({
		run: "r-build-5",
		stage: "build",
		trace: LANE_1,
		runner: SOL,
		from: t + SEC,
		took: 18 * MIN,
		outcome: send("exam_merge", "built"),
		tokens: [300_000, 250_000, 10_000],
		listUsd: 0.04,
	});
	const lane1End = T0 + 47 * MIN + 14 * SEC;
	step({
		run: "r-exam_merge-6",
		stage: "exam_merge",
		trace: LANE_1,
		runner: null,
		from: t + SEC,
		took: lane1End - (t + SEC),
		outcome: {kind: "stuck", why: "tests red"},
		listUsd: 0,
	});
	add(lane1End + 3 * 60 * MIN, owner, {type: "commented", body: "Looking at the red tests."});
	// 18 h 30 min later, restarted from plan: lane 2.
	const restart = add(lane1End + (18 * 60 + 30) * MIN, owner, {
		type: "restarted",
		from: "plan",
		base: "abcdef0",
		onto: "abcdef1",
	});
	const plan8 = restart + MIN;
	t = step({
		run: "r-plan-8",
		stage: "plan",
		trace: LANE_2,
		runner: astraAs,
		from: plan8,
		took: 5 * MIN + 6 * SEC,
		outcome: {kind: "ask", who: "owner", for: "questions"},
		tokens: [120_000, 100_000, 4_000],
		listUsd: null,
	});
	t = ask({
		ask: "a-approve-8",
		what: "Do you approve plan version 2?",
		trace: LANE_2,
		at: t + SEC,
		waited: 97 * SEC,
		pick: "approve",
	});
	t = step({
		run: "r-exam-9",
		stage: "exam",
		trace: LANE_2,
		runner: astraAs,
		from: t + SEC,
		took: 3 * MIN + 58 * SEC,
		outcome: {kind: "ask", who: "owner", for: "check_change"},
		tokens: [40_000, 0, 1_000],
		listUsd: null,
	});
	t = ask({
		ask: "a-merge-9",
		what: "Merge the rule changes?",
		trace: LANE_2,
		at: t + SEC,
		waited: 121 * SEC,
		pick: "merge",
	});
	t = step({
		run: "r-exam_merge-10",
		stage: "exam_merge",
		trace: LANE_2,
		runner: null,
		from: t + SEC,
		took: 6 * SEC,
		outcome: send("build", "checks red"),
		listUsd: 0,
	});
	// Lane 3: one code step.
	t = step({
		run: "r-exam_merge-11",
		stage: "exam_merge",
		trace: LANE_3,
		runner: null,
		from: t + 2 * 60 * MIN,
		took: 30 * SEC,
		outcome: {kind: "done", part: false},
		listUsd: 0,
	});
	const timeline: Entry[] = facts.map(([at, by, fact], i) => ({
		pos: i + 1,
		ticket: 117,
		by,
		at,
		fact,
	}));
	return {timeline, now: t + 60 * MIN, restart, plan8, lane1End};
};

/** Ticket 117's shape, as it ran. */
export const T117 = shapeOf(ASTRA);
/** The same, with a model no price table knows in astra's place. */
export const T117_MADE_UP = shapeOf({model: "made-up-model", harness: "codex"});

export const ASTRA_LANE_1 =
	astra(100_000, 60_000, 5_000) + astra(50_000, 20_000, 2_000) + astra(80_000, 40_000, 8_000);

export const ASTRA_LANE_2 = astra(120_000, 100_000, 4_000) + astra(40_000, 0, 1_000);
