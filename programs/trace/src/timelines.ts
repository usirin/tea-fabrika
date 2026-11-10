import type {Writer} from "@kampus/fabrika-old";
import {listUsdOf} from "@kampus/pipeline/stages/pipeline/agents";
import type {Entry, Fact} from "@kampus/pipeline/tickets/ticket";
import * as fc from "fast-check";
import type {Price} from "./ticket.ts";

// Made-up ticket timelines for the ticket view's laws (ticket 141), with what is true of each one
// written down as it is made: which lane each run and each ask is in, when each lane starts and
// ends, and what each step's price is. A law then checks the fold against that truth, not against
// a second copy of the fold. Today's version.
//
//   a story   filed days earlier; lanes of started/ended pairs, each lane one trace id, in order;
//             a `restarted` before a later lane; asks after a step, answered by a person; noise
//             (`commented`, `planned`, `session`, `pushed`) between them
//
// What the stories keep to, because the plan does not say what a lane does otherwise:
//   - only the newest lane may be open: its last step not ended, or its last ask not answered
//   - an ask's `trace`, when it names another lane than the one running, names an earlier one, and
//     that ask is answered
//   - times strictly grow, so no two facts share a millisecond

/** Ticket number of every story. */
export const NUMBER = 117;

const LANE_WRITER: Writer = {kind: "agent", id: "lane", for: "owner"};
const PEOPLE = ["owner", "teammate"] as const;

/** A lane's trace id: 32 hex characters, one per lane. */
const traceOfLane = (i: number): string => (i + 1).toString(16).padStart(2, "0").repeat(16);

const STAGES = [
	"triage",
	"plan",
	"exam",
	"test_writer",
	"build",
	"mutation",
	"review",
	"push",
	"merge",
] as const;

/**
 * Who runs a step. `code`: no model. `astra` and `sol` are in the pipeline's list prices (astra once
 * the builder adds it), `claude` is billed by its maker, and `madeup` is a model no table knows.
 */
const RUNNER = {
	code: null,
	astra: {model: "gpt-6-astra", harness: "codex"},
	sol: {model: "gpt-6.1-sol", harness: "codex"},
	claude: {model: "claude-made-up-4", harness: "claude"},
	madeup: {model: "made-up-model", harness: "codex"},
} as const;

type Runner = keyof typeof RUNNER;

/** What an `ended` holds as a price: left out, `null`, or a number, 0 among them. */
type Said = "absent" | null | number;
const said = fc.constantFrom<Said>("absent", null, 0, 0.0123, 0.5);

const stepShape = fc.record({
	runner: fc.constantFrom<Runner>("code", "astra", "sol", "claude", "madeup"),
	stage: fc.constantFrom(...STAGES),
	took: fc.integer({min: 1_000, max: 20 * 60_000}),
	listUsd: said,
	billed: said,
	input: fc.integer({min: 0, max: 200_000}),
	cachedShare: fc.integer({min: 0, max: 10}),
	output: fc.integer({min: 0, max: 20_000}),
	/** An ask after the step: whose trace it carries, and its answer. */
	ask: fc.option(
		fc.record({
			gap: fc.integer({min: 1, max: 60_000}),
			trace: fc.constantFrom<"own" | "none" | "earlier">("own", "none", "earlier"),
			waited: fc.integer({min: 1_000, max: 30 * 60_000}),
			pick: fc.constantFrom(0, 1),
			by: fc.constantFrom(...PEOPLE),
		}),
		{nil: null},
	),
	noise: fc.array(fc.constantFrom("commented", "planned", "session", "pushed"), {maxLength: 2}),
	gap: fc.integer({min: 1, max: 5 * 60_000}),
});

const laneShape = fc.record({
	restart: fc.boolean(),
	/** From the lane before to this one: up to a day and a half, as ticket 117's 18 h 30 min. */
	before: fc.integer({min: 1_000, max: 36 * 3_600_000}),
	steps: fc.array(stepShape, {minLength: 1, maxLength: 4}),
});

const storyShape = fc.record({
	lanes: fc.array(laneShape, {minLength: 1, maxLength: 3}),
	filedDaysBefore: fc.integer({min: 0, max: 5}),
	/** How the newest lane stands: all done, a step still running, or an ask not answered. */
	last: fc.constantFrom<"closed" | "running" | "asking">("closed", "running", "asking"),
	/** From the last fact to now. */
	tail: fc.integer({min: 0, max: 3_600_000}),
	start: fc.integer({min: 1_790_000_000_000, max: 1_800_000_000_000}),
});

/** One step as made: the truth a law checks a step row against. */
interface TrueStep {
	readonly run: string;
	readonly stage: string;
	readonly from: number;
	/** `null`: it has not ended. */
	readonly to: number | null;
	readonly model: string | null;
	readonly harness: string | null;
	/**
	 * `null`: a step with a model that has not ended, so it has no price yet. It is neither a price nor
	 * "no list price", so the laws take any case for it but `usd`, `unknown` and `none`.
	 */
	readonly price: Price | null;
}

/** One ask as made. `lane`: the lane it belongs in, by its place. */
interface TrueAsk {
	readonly ask: string;
	readonly what: string;
	readonly at: number;
	readonly lane: number;
	/** `null`: not answered. */
	readonly answer: {readonly at: number; readonly pick: string; readonly by: string} | null;
}

export interface TrueLane {
	readonly trace: string;
	readonly restart: {readonly at: number; readonly from: string} | null;
	readonly from: number;
	/** Its last ended or answered. `null`: it is open, so it runs to now. */
	readonly to: number | null;
	readonly steps: readonly TrueStep[];
	readonly asks: readonly TrueAsk[];
}

export interface Story {
	readonly timeline: readonly Entry[];
	readonly now: number;
	readonly lanes: readonly TrueLane[];
}

/** A step's price as L6 words it, from what its `ended` holds. */
const priceFrom = (
	runner: (typeof RUNNER)[Runner],
	ended: {
		readonly listUsd: Said;
		readonly billed: Said;
		readonly input: number;
		readonly cached: number;
		readonly output: number;
	},
): Price => {
	if (runner === null) {
		return {kind: "none"};
	}

	if (typeof ended.listUsd === "number") {
		return {kind: "usd", usd: ended.listUsd};
	}

	// A model in the list-price table: its price comes back from the tokens, so a `null` written
	// before its row landed loses nothing (plan, section 1).
	const derived = listUsdOf(runner.model, ended);

	if (derived !== null) {
		return {kind: "usd", usd: derived};
	}

	if (runner.harness === "claude" && typeof ended.billed === "number") {
		return {kind: "usd", usd: ended.billed};
	}

	return {kind: "unknown"};
};

const who = (runner: (typeof RUNNER)[Runner]) =>
	runner === null ? {model: null, harness: null} : {model: runner.model, harness: runner.harness};

type Shape = typeof storyShape extends fc.Arbitrary<infer T> ? T : never;

/** The story a shape gives, its facts and its truth. */
const storyOf = (shape: Shape): Story => {
	const entries: Entry[] = [];
	let at = shape.start;
	const put = (by: Writer, fact: Fact, gap = 1) => {
		at += Math.max(1, gap);
		entries.push({pos: entries.length + 1, ticket: NUMBER, by, at, fact});
		return at;
	};
	const person = (id: string): Writer => ({kind: "user", id});
	// Filed days before the first run: the 19 h sliver bug's cause.
	at -= shape.filedDaysBefore * 86_400_000 + 1;
	put(person("owner"), {type: "filed", title: "The map should take a ticket on a pipe", body: ""});
	at = shape.start;
	let runs = 0;
	let asks = 0;
	const lanes: TrueLane[] = [];
	shape.lanes.forEach((laneShape_, i) => {
		const trace = traceOfLane(i);
		const newest = i === shape.lanes.length - 1;
		at += laneShape_.before;
		const restart =
			i > 0 && laneShape_.restart
				? {
						at: put(LANE_WRITER, {
							type: "restarted",
							from: laneShape_.steps[0]?.stage ?? "plan",
							base: null,
							onto: "abcdef0",
						}),
						from: laneShape_.steps[0]?.stage ?? "plan",
					}
				: null;
		const steps: TrueStep[] = [];
		const laneAsks: TrueAsk[] = [];
		let last: number | null = null;
		const later = (t: number) => {
			last = last === null ? t : Math.max(last, t);
		};
		laneShape_.steps.forEach((step, j) => {
			const final = newest && j === laneShape_.steps.length - 1;
			const runner = RUNNER[step.runner];
			const run = `r-${step.stage}-${++runs}`;
			const from = put(
				LANE_WRITER,
				{
					type: "started",
					run,
					stage: step.stage,
					task: null,
					log: null,
					trace,
					...(runner === null ? {} : {model: runner.model, harness: runner.harness}),
				},
				step.gap,
			);

			for (const noise of step.noise) {
				if (noise === "session") {
					put(LANE_WRITER, {type: "session", run, id: `s-${run}`});
				}

				if (noise === "commented") {
					put(person("owner"), {type: "commented", body: "Seen it."});
				}

				if (noise === "planned") {
					put(LANE_WRITER, {type: "planned", version: 1, tasks: []});
				}

				if (noise === "pushed") {
					put(LANE_WRITER, {type: "pushed", head: "abcdef0", commits: []});
				}
			}

			if (final && shape.last === "running") {
				// No `ended`: a step with a model has no price yet. It is not `unknown`: that says the
				// model has no list price, and astra has one (review B2). Code is still `none`.
				const price: Price | null = runner === null ? {kind: "none"} : null;
				steps.push({run, stage: step.stage, from, to: null, ...who(runner), price});
				return;
			}

			const cached = Math.floor((step.input * step.cachedShare) / 10);
			const tokens = {input: step.input, cached, output: step.output};
			const prices = {listUsd: step.listUsd, billed: step.billed, ...tokens};
			const asking = step.ask !== null || (final && shape.last === "asking");
			const usd =
				runner?.harness === "claude"
					? typeof step.billed === "number"
						? step.billed
						: 0
					: typeof step.listUsd === "number"
						? step.listUsd
						: 0;
			const to = put(
				LANE_WRITER,
				{
					type: "ended",
					run,
					stage: step.stage,
					outcome: asking
						? {kind: "ask", who: "owner", for: "approval"}
						: {kind: "send", to: "build", why: "planned"},
					usd,
					input: step.input,
					output: step.output,
					turns: 3,
					cached,
					...(step.listUsd === "absent" ? {} : {listUsd: step.listUsd}),
					...(step.billed === "absent" ? {} : {billed: step.billed}),
					...(runner === null ? {} : {model: runner.model, harness: runner.harness}),
				},
				step.took,
			);
			later(to);
			steps.push({
				run,
				stage: step.stage,
				from,
				to,
				...who(runner),
				price: priceFrom(runner, prices),
			});

			if (!asking) {
				return;
			}

			const shapeOfAsk: NonNullable<typeof step.ask> = step.ask ?? {
				gap: 1_000,
				trace: "own",
				waited: 1_000,
				pick: 0,
				by: "owner",
			};
			const unanswered = final && shape.last === "asking";
			// An ask that names an earlier lane comes only on a lane's first step, and is always
			// answered: so an older lane is never left open, and no ask without a trace falls in the
			// time an older lane's late answer stretches over.
			const named =
				shapeOfAsk.trace !== "earlier"
					? shapeOfAsk.trace
					: i > 0 && j === 0 && !unanswered
						? "earlier"
						: "own";
			const lane = named === "earlier" ? i - 1 : i;
			const ask = `a-approve-${++asks}`;
			const picks = ["approve", "no"] as const;
			const what = `Do you approve plan version ${asks}?`;
			const askedAt = put(
				LANE_WRITER,
				{
					type: "asked",
					ask,
					what,
					picks: [...picks],
					...(named === "none" ? {} : {trace: traceOfLane(lane)}),
				},
				shapeOfAsk.gap,
			);
			const pick = picks[shapeOfAsk.pick] ?? "approve";
			const answer = unanswered
				? null
				: {
						at: put(
							person(shapeOfAsk.by),
							{type: "answered", ask, pick, note: "A note nobody may see on a span."},
							shapeOfAsk.waited,
						),
						pick,
						by: shapeOfAsk.by,
					};
			const trueAsk: TrueAsk = {ask, what, at: askedAt, lane, answer};

			if (lane === i) {
				laneAsks.push(trueAsk);

				if (answer !== null) {
					later(answer.at);
				}
			} else {
				// Its lane is an earlier one, already in the list: the answer moves that lane's end.
				const earlier = lanes[lane];

				if (earlier !== undefined) {
					lanes[lane] = {
						...earlier,
						asks: [...earlier.asks, trueAsk],
						to: answer === null ? earlier.to : Math.max(earlier.to ?? 0, answer.at),
					};
				}
			}
		});
		const firstStart = steps[0]?.from ?? at;
		const open = newest && shape.last !== "closed";
		lanes.push({
			trace,
			restart,
			from: restart?.at ?? firstStart,
			to: open ? null : last,
			steps,
			asks: laneAsks,
		});
	});
	return {timeline: entries, now: at + shape.tail, lanes};
};

/** Any story: one to three lanes, each with its asks, restarts and noise. */
export const stories: fc.Arbitrary<Story> = storyShape.map(storyOf);

/** Eight fixed stories, the same on every run: for the machine's laws, which draw from a list. */
export const SOME_STORIES: readonly Story[] = fc.sample(stories, {numRuns: 8, seed: 141});

/** The kinds of fact a replay stops at. */
export const STOPS: ReadonlySet<Fact["type"]> = new Set([
	"started",
	"ended",
	"asked",
	"answered",
	"restarted",
]);
