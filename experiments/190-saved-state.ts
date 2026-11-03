// Experiment 190: GGPO's sync test, tried on today's lane machine. See 190-saved-state.md.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY \
//     nice -n 15 node experiments/190-saved-state.ts
//
// Today's version only: the real `lane` reducer and its real `Lane` schema from
// packages/pipeline/src/stages/pipeline/machine.ts. For each random Msg list (fast-check, fixed
// seed), it folds the list once with no stop. Then, for every step k, it saves the model at k
// (Schema encode, JSON text, JSON parse, Schema decode), boots a new machine from it through
// `init`, folds the rest of the list, and compares every later model and Cmd with the run that
// never stopped. A planted mistake (a field the schema does not keep) shows the law can fail.
// No model, no key, no network, $0. Prints one JSON line per machine.

import {isDeepStrictEqual} from "node:util";
import {foldEvents} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
import {make} from "@kampus/pipeline/entity";
import {LaneId} from "@kampus/pipeline/ids";
import {
	askPerson,
	claimLane,
	EMPTY,
	Lane,
	lane,
	readFiled,
	releaseLane,
	runStep,
} from "@kampus/pipeline/stages/pipeline/machine";
import {Schema} from "effect";
import * as fc from "fast-check";

type Machine = typeof lane;
type Msg = MsgOf<Machine>;

const SEED = 190;
const RUNS = 300;
const ID = make(LaneId)("L1");
const STEP = runStep({
	number: 7,
	count: 1,
	step: "triage",
	round: 1,
	carry: EMPTY,
	intent: "lane/7/1/triage",
});
const ASK = askPerson({number: 7, ask: "a", what: "w", picks: ["x"], intent: "i"});
const READ = readFiled({number: 7});
const CLAIM = claimLane({number: 7, lane: ID, intent: "c"});
const RELEASE = releaseLane({number: 7, lane: ID, intent: "r"});

// The same Msg table as machine.laws.test.ts, cut to what reaches far.
const OUTCOMES = [
	{kind: "done", part: false},
	{kind: "skip", why: "no_lines"},
	{kind: "ask", who: "owner", for: "questions"},
	{kind: "send", to: "builder", why: "review_failed"},
	{kind: "stuck", why: "push_failed"},
] as const;
const msg: fc.Arbitrary<Msg> = fc.oneof(
	fc.constant({type: "resume"}),
	fc
		.record({ask: fc.string(), pick: fc.constantFrom("approve", "merge", "no", "again", "stop")})
		.map((v) => ({type: "lane_answered", ...v})),
	fc
		.record({state: fc.constantFrom("open" as const, "closed" as const), mine: fc.boolean()})
		.map((v) => readFiled.ok(READ, v, 0)),
	fc.constant(readFiled.err(READ, {_tag: "unknown"}, 0)),
	fc.constant(claimLane.ok(CLAIM, ID, 0)),
	fc.constant(claimLane.err(CLAIM, {_tag: "unknown"}, 0)),
	fc.constantFrom(...OUTCOMES).map((outcome) => runStep.ok(STEP, {outcome, carry: {}} as never, 0)),
	fc.constant(runStep.err(STEP, {_tag: "unknown"}, 0)),
	fc.constant(askPerson.ok(ASK, null, 0)),
	fc.constant(releaseLane.ok(RELEASE, "released", 0)),
	fc.constant(releaseLane.err(RELEASE, {_tag: "unknown"}, 0)),
);
const opening: readonly Msg[] = [
	{type: "start", number: 7, lane: ID},
	readFiled.ok(READ, {state: "open", mine: true}, 0),
	claimLane.ok(CLAIM, ID, 0),
];
const lists = fc.array(msg, {minLength: 1, maxLength: 60}).map((rest) => [...opening, ...rest]);

/** An answer names the question the lane asks now, as the laws file does. */
const withAnswers = (m: Machine): Machine =>
	({
		...m,
		update: {
			...m.update,
			lane_answered: (s: any, a: any) =>
				m.update.lane_answered(s, s.phase === "asking" ? {...a, ask: s.question.ask} : a),
		},
	}) as Machine;

/** Save and load, as a store would: through the schema and through text. */
const encode = Schema.encodeUnknownSync(Lane);
const decode = Schema.decodeUnknownSync(Lane);
const roundTrip = (s: unknown) => decode(JSON.parse(JSON.stringify(encode(s))));

type Found = {k: number; at: string; list: number};

/** GGPO's sync test: stop at every step, load, go on, and compare with the run that never stopped. */
const syncTest = (machine: Machine) => {
	let lists_ = 0;
	let stops = 0;
	let first: Found | null = null;
	let broken = 0;
	const phases: Record<string, number> = {};
	fc.assert(
		fc.property(lists, (msgs) => {
			lists_++;
			const straight = foldEvents(machine, undefined, null, msgs);
			for (const s of straight.states)
				phases[(s as Lane).phase] = (phases[(s as Lane).phase] ?? 0) + 1;
			for (let k = 0; k < msgs.length; k++) {
				stops++;
				let loaded: unknown;
				try {
					loaded = roundTrip(straight.states[k]);
				} catch {
					broken++;
					first ??= {k, at: "decode refused the saved model", list: lists_};
					return true;
				}
				const resumed = foldEvents(machine, undefined, loaded as never, msgs.slice(k));
				const same =
					isDeepStrictEqual(resumed.states, straight.states.slice(k)) &&
					isDeepStrictEqual(
						resumed.steps.map((s) => s.cmds),
						straight.steps.slice(k).map((s) => s.cmds),
					);
				if (!same) {
					broken++;
					const i = resumed.states.findIndex(
						(s, j) => !isDeepStrictEqual(s, straight.states[k + j]),
					);
					first ??= {k, at: `models part at step ${k + Math.max(i, 0)}`, list: lists_};
					return true;
				}
			}
			return true;
		}),
		{numRuns: RUNS, seed: SEED},
	);
	return {lists: lists_, stops, broken, first, phases};
};

// A planted mistake: the claim keeps a field the schema does not, and a later step reads it.
const planted = withAnswers({
	...lane,
	update: {
		...lane.update,
		lane_claim_ok: (s: any, m: any) => {
			const [next, cmds] = lane.update.lane_claim_ok(s, m);
			return [{...next, memo: "claimed here"}, cmds];
		},
		resume: (s: any) => (s.memo === undefined ? lane.update.resume(s) : [s, []]),
	},
} as Machine);

const t0 = performance.now();
const real = syncTest(withAnswers(lane));
const t1 = performance.now();
const plant = syncTest(planted);
const t2 = performance.now();
console.log(
	JSON.stringify({machine: "lane (today)", seed: SEED, ...real, ms: Math.round(t1 - t0)}),
);
console.log(
	JSON.stringify({machine: "lane, planted", seed: SEED, ...plant, ms: Math.round(t2 - t1)}),
);
