// Experiment 120: can ship's property tests be written with only Effect 4's own `Arbitrary`, with
// no hand-written world and no `walk.ts`, and still catch what 119's walks caught?
//
// Arm C draws every message from a schema and folds the real reducer over them, the way Effect's
// own docs test a state machine ("Removing irrelevant commands", `effect/Arbitrary`), and the way
// elm-test does with a fuzzer and a fold over `update`:
//   - outside messages from a schema of ship's Msg type (ship has none, so it is written here);
//   - answers from each Cmd's own `ok` schema and `err` tags, as the machine declares them;
//   - an answer comes only for a Cmd that was sent and is still waiting: a drawn `pick` names one;
//   - the laws of `laws/ship.ts`, plus "update throws", after every step;
//   - and the suite fails when a Msg type is never sent across a seed's run.
//
// Run with (Stryker is not in the workspace: install it once, anywhere outside the repo)
//   node experiments/120-schema-property-tests.ts reach            # what the generator reaches (STEER=0 SIZE=60: no help)
//   node experiments/120-schema-property-tests.ts gates            # the gate's answers on drawn reads, by size
//   node experiments/120-schema-property-tests.ts timing           # where a walk's time goes
//   node experiments/120-schema-property-tests.ts plants           # planted breaks, then the real code
//   STRYKER=<dir>/node_modules/.bin/stryker CONCURRENCY=8 nice -n 15 node experiments/120-schema-property-tests.ts run
//   node experiments/120-schema-property-tests.ts report           # joins Stryker's report, the rows and 119
// Stryker calls this same script once per mutant (`mutant`), which runs arm C as a child process
// with a time limit, for the mutants of SAMPLE and NAMED only. The run's files go to runs/120/.
// No model, no key, no network. Writes results/120-schema-property-tests.json.

import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {CriterionId, criterionId, verdictId} from "@kampus/pipeline/ids";
import {Broke, type Law, type Step, stepOf, type Update} from "@kampus/pipeline/laws/explore";
import {CHOICE} from "@kampus/pipeline/laws/sample";
import {
	type AnyShipMsg,
	actsAfterTheEnd,
	forgetsMissingReview,
	HEADS,
	type Keeping,
	keepsAnOldPass,
	landsAnyHead,
	PR,
	shipLaws,
	showShipMsg,
	skipsTheRead,
	takesAnOldVersion,
} from "@kampus/pipeline/laws/ship";
import {nameOf} from "@kampus/pipeline/stages/outcome";
import {reviewsOf, ShipFacts} from "@kampus/pipeline/stages/ship/facts";
import {shipGate} from "@kampus/pipeline/stages/ship/gate";
import {type Ship, type ShipCmd, type ShipMsg, ship} from "@kampus/pipeline/stages/ship/machine";
import {Criterion, Row} from "@kampus/pipeline/stages/ship/ready";
import {Arbitrary, Effect, Schema} from "effect";

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const HERE = import.meta.dirname;
const ROOT = HERE.slice(0, HERE.lastIndexOf("/"));
const RUN = env("RUN_DIR", `${ROOT}/runs/120`);
const OUT = `${HERE}/results/120-schema-property-tests.json`;
const B119 = env("B119", `${HERE}/results/119-mutation-testing.json`);
/** The same budget as 119's plain walks: 5 seeds of 10 s, a seed counts as short when it caught within 1 s. */
const BUDGET_MS = Number(env("BUDGET_MS", "10000"));
const SHORT_MS = 1_000;
const SEEDS = [1, 2, 3, 4, 5];
/** The most messages in one input, as 119's walk of ship alone (`ONE_LENGTH`). */
const LENGTH = 60;
/** Effect's `size`: how big each drawn value may grow. Set by `reach` (see the write-up). */
const SIZE = Number(env("SIZE", "6"));
/** A drawn read takes the ready read's value for each field but one time in LEAN. */
const LEAN = Number(env("LEAN", "4"));
/** An answer is an error one time in FAILS. */
const FAILS = Number(env("FAILS", "4"));
/** Messages a run takes after its end before the walk starts a new one. */
const AFTER = Number(env("AFTER", "4"));
const ARM_MS = 180_000;
/** STEER=0: every field as its schema has it, to see what the generator reaches with no help. */
const STEER = env("STEER", "1") === "1";
const FILES = [
	"packages/pipeline/src/stages/ship/machine.ts",
	"packages/pipeline/src/stages/ship/gate.ts",
];
/**
 * The run was cut from all 569 mutants to these 150, for cost and noise: 119's ids, drawn with
 * seed 119120 by a seeded shuffle (36 "both" and 114 "neither" in 119). Every other mutant exits
 * at once, as survived, and is not counted.
 */
const SAMPLE = new Set(
	"2,10,11,14,16,26,28,29,34,36,39,41,42,43,44,46,52,53,58,59,61,64,69,76,82,83,87,90,92,99,103,106,107,108,110,112,113,118,120,122,124,131,132,135,136,138,145,146,147,150,159,162,165,168,173,175,178,179,186,187,188,189,194,195,199,204,208,215,217,219,237,240,243,246,252,253,269,270,272,273,280,291,296,299,311,314,315,317,318,322,331,337,339,344,346,347,350,358,359,364,366,367,377,378,381,395,398,400,402,404,406,411,414,415,426,429,430,431,440,446,447,456,458,463,464,467,473,481,482,485,487,488,490,491,492,494,499,503,504,508,511,512,513,515,536,545,548,553,559,565".split(
		",",
	),
);
/** 119's three narrow mutants, reported on their own. 515 is in the sample too. */
const NAMED = ["502", "515", "516"];

// ---- lines: msg schema
// Ship's outside Msgs as a schema. The machine has only a type, so this is what machine.ts would
// hold beside it; the two checks below fail to compile if they drift apart.
const Pr = STEER ? Schema.Literal(PR) : Schema.String;
const Head = STEER ? Schema.Literals(HEADS) : Schema.String;
const At = {pr: Pr, head: Head};
const Outside = Schema.Union([
	Schema.Struct({type: Schema.Literal("start"), pr: Pr}),
	Schema.Struct({type: Schema.Literal("resume")}),
	Schema.Struct({type: Schema.Literal("ship_checks"), ...At}),
	Schema.Struct({
		type: Schema.Literal("ship_queue"),
		...At,
		reading: Schema.Literal("landed"),
		commit: Schema.String,
	}),
	Schema.Struct({type: Schema.Literal("ship_queue"), ...At, reading: Schema.Literal("ejected")}),
	Schema.Struct({type: Schema.Literal("ship_checks_overdue"), ...At, wait: Schema.Int}),
	Schema.Struct({type: Schema.Literal("ship_queue_overdue"), ...At}),
]);
export const fits = (m: typeof Outside.Type): ShipMsg => m;
export const covers = (m: ShipMsg): typeof Outside.Type => m;
// ---- end

// ---- lines: steering
// What a drawn read must share with the run for the gate to say go: a verdict row on a criterion
// of this read, at its version, at this head. Each field named here is narrowed; nothing else is.
const Id = STEER ? Schema.Literals(["c1", "c2"]).pipe(Schema.brand("CriterionId")) : CriterionId;
const Version = STEER ? Schema.Literals([1, 2]) : Criterion.fields.version;
const Facts = Schema.Struct({
	...ShipFacts.fields,
	head: Head,
	criteria: Schema.NullOr(
		Schema.NonEmptyArray(Schema.Struct({...Criterion.fields, id: Id, version: Version})),
	),
	verdicts: Schema.Array(
		Schema.Struct({...Row.fields, criterion: Id, version: Version, head: Head}),
	),
});
// With two ids, a read holding one criterion twice is likely, and the real code breaks a law on it
// (see the write-up). The ledger keys criteria by id, so here they take their ids by place.
const IDS = [criterionId("c1"), criterionId("c2")];
const Said = Schema.Struct({version: Version, text: Criterion.fields.text});
const CRITERIA = Arbitrary.map(
	Arbitrary.schema(Schema.NullOr(Schema.NonEmptyArray(Said).check(Schema.isMaxLength(IDS.length)))),
	(cs) => (cs === null ? null : cs.map((c, i) => ({...c, id: IDS[i] as CriterionId}))),
);
const drawn = (k: string, f: Schema.Top) =>
	STEER && k === "criteria" ? CRITERIA : Arbitrary.schema(f);
// The gate says go only when about ten fields each hold their one good value, so drawn alone a
// read says go about once in 20,000. One ready read, and each field takes its value but one time
// in LEAN.
const READY: ShipFacts = {
	head: "A",
	state: "open",
	ours: true,
	ticket: "none",
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: {tested: "m", tip: "m"},
	criteria: [{id: criterionId("c1"), version: 1, text: "t"}],
	verdicts: [
		{
			id: verdictId("v1"),
			criterion: criterionId("c1"),
			version: 1,
			head: "A",
			grade: "pass",
			proof: "p",
		},
	],
};
const COIN = Arbitrary.schema(Schema.Boolean);
/** True one time in `n`. */
const oneIn = (n: number) =>
	Arbitrary.map(
		Arbitrary.schema(Schema.Int.check(Schema.isBetween({minimum: 0, maximum: n - 1}))),
		(x) => x === 0,
	);
const leans = <A>(ready: A, drawn: Arbitrary.Arbitrary<A>) =>
	STEER
		? Arbitrary.flatMap(oneIn(LEAN), (draw) => (draw ? drawn : Arbitrary.Constant(ready)))
		: drawn;
const FACTS = Arbitrary.all(
	Object.fromEntries(
		Object.entries(Facts.fields).map(([k, f]) => [
			k,
			leans(READY[k as keyof ShipFacts], drawn(k, f)),
		]),
	),
);
// Half of all answers were errors, and most errors end the run. An answer fails one time in FAILS.
const FAILED = STEER ? oneIn(FAILS) : COIN;
// A walk of LENGTH messages whatever the size: Effect's `size` caps both a list's length and every
// value in it, and a read drawn at size 60 takes about 0.5 ms.
const WALK = STEER ? {minLength: LENGTH, maxLength: LENGTH} : {maxLength: LENGTH};
// ---- end

// ---- lines: generator
/** One Cmd definition, as the machine lists it: its name, its two answer types, its schema, its error tags. */
interface Def {
	readonly cmdType: string;
	readonly errType: string;
	readonly schema: {readonly ok: unknown};
	readonly errTags: readonly string[];
	readonly ok: (cmd: never, value: never, at?: number) => AnyShipMsg;
	readonly err: (cmd: never, error: never, at?: number) => AnyShipMsg;
}
const DEFS: readonly Def[] = ship.cmds;
const okOf = (d: Def): Arbitrary.Arbitrary<unknown> => {
	if (d.cmdType === "ship_facts") return FACTS;
	if (!Schema.isSchema(d.schema.ok))
		throw new Error(`${d.cmdType}: its ok is not an Effect schema`);
	return Arbitrary.schema(d.schema.ok);
};
/** An answer to whichever Cmd `pick` names: one value per Cmd, drawn from its own schemas. */
const ANSWER = Arbitrary.all({
	pick: Arbitrary.schema(CHOICE),
	fails: FAILED,
	...Object.fromEntries(DEFS.map((d) => [d.cmdType, okOf(d)])),
	...Object.fromEntries(
		DEFS.map((d) => [
			d.errType,
			Arbitrary.schema(Schema.Struct({_tag: Schema.Literals(d.errTags)})),
		]),
	),
});
type Answer = {readonly pick: number; readonly fails: boolean} & Readonly<Record<string, unknown>>;
type Event = typeof Outside.Type | Answer;
const OUTSIDE = Arbitrary.schema(Outside);
const EVENT: Arbitrary.Arbitrary<Event> = Arbitrary.flatMap(COIN, (outside) =>
	outside ? OUTSIDE : (ANSWER as Arbitrary.Arbitrary<Answer>),
);
const EVENTS = Arbitrary.array(EVENT, WALK);
// ---- end

// ---- lines: resolver
const BY_TYPE = new Map(DEFS.map((d) => [d.cmdType, d]));
/** The answer `e` gives, to the waiting Cmd its pick names, and the Cmds still waiting after. `null`: none waits. */
function resolve(
	e: Answer,
	waiting: readonly ShipCmd[],
): readonly [AnyShipMsg, readonly ShipCmd[]] | null {
	if (waiting.length === 0) return null;
	const i = e.pick % waiting.length;
	const cmd = waiting[i] as ShipCmd;
	const d = BY_TYPE.get(cmd.type) as Def;
	// The value was drawn from this Cmd's own schema, so it is one of its answers.
	const msg = e.fails
		? d.err(cmd as never, e[d.errType] as never, 0)
		: d.ok(cmd as never, e[d.cmdType] as never, 0);
	return [msg, waiting.filter((_, j) => j !== i)];
}
// ---- end

// ---------------------------------------------------------------- what the generator reaches

/** Counts across one seed's run: each Msg type sent and the ones that changed something, and where runs went. */
interface Reach {
	readonly sent: Map<string, number>;
	readonly took: Map<string, number>;
	readonly phases: Map<string, number>;
	readonly ends: Map<string, number>;
	/** Answers drawn when no Cmd was waiting: thrown away. */
	idle: number;
	events: number;
}
const reachOf = (): Reach => ({
	sent: new Map(),
	took: new Map(),
	phases: new Map(),
	ends: new Map(),
	idle: 0,
	events: 0,
});
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
/** The machine's whole alphabet: every Msg type its update takes, as tea's `msgTypeKeys` reads it. */
const ALPHABET = Object.keys(ship.update).sort();

// ---- lines: fold
/** One fold over the events: the real reducer, each law after every step. */
interface Folded {
	readonly broke: {readonly law: string; readonly why: string} | null;
	readonly path: readonly string[];
}
function fold<S extends Ship>(
	update: Update<S, AnyShipMsg, ShipCmd>,
	events: readonly Event[],
	reach: Reach,
): Folded {
	const laws: readonly Law<S, AnyShipMsg, ShipCmd>[] = shipLaws<S>();
	let watches = laws.map((l) => l.begin());
	let s = {phase: "idle"} as S;
	let waiting: readonly ShipCmd[] = [];
	const path: string[] = [];
	let over = 0;
	for (const e of events) {
		reach.events++;
		let msg: AnyShipMsg;
		// Steering: most runs end within a few messages. AFTER messages past the end, a new run
		// starts in the same walk, with fresh laws, and this event is its start.
		if (s.phase === "over" && over++ === AFTER) {
			[s, waiting, watches, over] = [{phase: "idle"} as S, [], laws.map((l) => l.begin()), 0];
			path.push("(a new run)");
			msg = {type: "start", pr: PR};
		} else if ("type" in e) {
			msg = e;
			// A restart: every Cmd in flight died with the process.
			if (e.type === "resume") waiting = [];
		} else {
			const r = resolve(e, waiting);
			if (r === null) {
				reach.idle++;
				continue;
			}
			[msg, waiting] = r;
		}
		path.push(showShipMsg(msg));
		bump(reach.sent, msg.type);
		let next: S;
		let cmds: readonly ShipCmd[];
		// biome-ignore lint/plugin: a throw from the reducer under test is what this law measures, in a sync loop run millions of times, as walk.ts does
		try {
			[next, cmds] = update(s, msg);
		} catch (error) {
			return {
				broke: {law: "update throws", why: error instanceof Error ? error.message : `${error}`},
				path,
			};
		}
		if (next !== s || cmds.length > 0) bump(reach.took, msg.type);
		bump(reach.phases, next.phase);
		if (next.phase === "over" && s.phase !== "over") bump(reach.ends, nameOf(next.outcome));
		const step: Step<S, AnyShipMsg, ShipCmd> = {prev: s, msg, next, cmds};
		let broke: Folded["broke"] = null;
		// biome-ignore lint/plugin: a law that throws on a mutant's state is a finding to report, not an error to model
		try {
			watches = watches.map((w, i) => {
				const after = w.step(step);
				if (!(after instanceof Broke)) return after;
				broke ??= {law: laws[i]?.name ?? `law ${i}`, why: after.why};
				return w;
			});
		} catch (error) {
			return {
				broke: {law: "a law throws", why: error instanceof Error ? error.message : `${error}`},
				path,
			};
		}
		if (broke !== null) return {broke, path};
		s = next;
		waiting = [...waiting, ...cmds];
	}
	return {broke: null, path};
}
// ---- end

// ---------------------------------------------------------------- the property, by seed

/** One seed: what it found within its budget. */
interface Seeded {
	readonly seed: number;
	readonly caught: boolean;
	readonly ms: number;
	/** Inputs tried before the break, or in all. */
	readonly runs: number;
	readonly law: string | null;
	readonly why: string | null;
	readonly path: readonly string[] | null;
	/** Msg types never sent in the whole seed. Not empty: the suite fails. `null`: a law broke first. */
	readonly never: readonly string[] | null;
	readonly reach: ReachOut;
	/** Caught: whether `checkEffect`, drawing again from the same seed string, failed it too. */
	readonly redrawn: boolean | null;
}
type ReachOut = ReturnType<typeof reachOut>;
const reachOut = (r: Reach) => ({
	sent: Object.fromEntries([...r.sent].sort()),
	took: Object.fromEntries([...r.took].sort()),
	phases: Object.fromEntries([...r.phases].sort()),
	ends: Object.fromEntries([...r.ends].sort((a, b) => b[1] - a[1])),
	idle: r.idle,
	events: r.events,
});

// ---- lines: seed loop
// `checkEffect` builds a shrink tree for every input it draws, about ten times the cost of the
// draw (`timing`). So the search draws with `sampleEffect`, one input per seed string, and only an
// input that breaks a law is drawn again by `checkEffect` from that same string, to shrink it.
const seedOf = <S extends Ship>(
	update: Update<S, AnyShipMsg, ShipCmd>,
	seed: number,
	ms = BUDGET_MS,
) =>
	Effect.gen(function* () {
		const reach = reachOf();
		const started = performance.now();
		const holds = (es: readonly Event[]) => fold(update, es, reachOf()).broke === null;
		let runs = 0;
		while (performance.now() - started < ms) {
			const at = {size: SIZE, seed: `${seed}:${runs++}`};
			const [es] = yield* Arbitrary.sampleEffect(EVENTS, {...at, count: 1});
			if (es === undefined || fold(update, es, reach).broke === null) continue;
			const ran = Math.round(performance.now() - started);
			const r = yield* Arbitrary.checkEffect(EVENTS, holds, {...at, runs: 1, maxShrinks: 5_000});
			// The same seed string draws the same input, so the check fails it again and shrinks it.
			const shrunk = fold(update, r._tag === "Falsified" ? r.shrunkInput : es, reachOf());
			const {law, why} = shrunk.broke ?? {law: null, why: null};
			return {
				seed,
				caught: true,
				ms: ran,
				runs,
				law,
				why,
				path: shrunk.path,
				never: null,
				reach: reachOut(reach),
				redrawn: r._tag === "Falsified",
			} satisfies Seeded;
		}
		const never = ALPHABET.filter((t) => !reach.sent.has(t));
		const at = Math.round(performance.now() - started);
		return {
			seed,
			caught: false,
			ms: at,
			runs,
			law: null,
			why: null,
			path: null,
			never,
			reach: reachOut(reach),
			redrawn: null,
		} satisfies Seeded;
	});
// ---- end

/** Arm C: 5 seeds. Killed when any seed broke a law, or any seed never sent some Msg type. */
const armC = <S extends Ship>(update: Update<S, AnyShipMsg, ShipCmd>) =>
	Effect.gen(function* () {
		const seeds: Seeded[] = [];
		for (const seed of SEEDS) seeds.push(yield* seedOf(update, seed));
		return seeds;
	});

// ---------------------------------------------------------------- planted breaks

const real: Update<Ship, AnyShipMsg, ShipCmd> = stepOf<Ship, AnyShipMsg, ShipCmd>(ship);
/** A handler that returns nothing, as a Stryker mutant of a `switch` case or an arrow body makes it. */
// biome-ignore lint/plugin: the plant must return what the mutant returns, nothing, which the type rightly forbids
const nothing = undefined as unknown as readonly [Ship, readonly ShipCmd[]];
const merging = (s: Ship, m: AnyShipMsg) =>
	s.phase === "merging" &&
	(m.type === "ship_merge_ok" || m.type === "ship_merge_err") &&
	m.cmd.intent === s.asked.intent;

/** 119's mutants, written as plants around the real reducer, and the planted mistakes of `laws/ship.ts`. */
const PLANTS: Record<string, Update<Keeping, AnyShipMsg, ShipCmd>> = {
	// 502, machine.ts:386: `case "conflicts"` made `case ""` in the merge answer.
	"502 merge conflicts falls through": (s, m) =>
		merging(s, m) && m.type === "ship_merge_ok" && m.value.reading === "conflicts"
			? nothing
			: real(s, m),
	// 515, machine.ts:392: `case "stale"` made `case ""` in the merge answer.
	"515 merge stale falls through": (s, m) =>
		merging(s, m) && m.type === "ship_merge_ok" && m.value.reading === "stale"
			? nothing
			: real(s, m),
	// 516, machine.ts:397: the `ship_merge_err` handler made `() => undefined`.
	"516 merge error returns nothing": (s, m) => (m.type === "ship_merge_err" ? nothing : real(s, m)),
	// 93, gate.ts:83: `reviews === "failed"` made `false`: a failed review goes on to the next line.
	"93 a failed review is let through": (s, m) =>
		m.type === "ship_facts_ok" && reviewsOf(m.value.reviews) === "failed"
			? real(s, {
					...m,
					value: {
						...m.value,
						reviews:
							m.value.reviews?.map((k) =>
								k.verdict === "failed" ? {...k, verdict: "passed"} : k,
							) ?? null,
					},
				})
			: real(s, m),
	// 101, gate.ts:84: `reviews === "missing"` made `false`. The same as `forgetsMissingReview` below.
	// 540, machine.ts:404: `"ejected"` made `""`: an ejected pull request is taken as landed.
	"540 ejected is taken as landed": (s, m) =>
		m.type === "ship_queue" && m.reading === "ejected"
			? // biome-ignore lint/plugin: the mutant reads the commit of an ejected message, which has none
				real(s, {...m, reading: "landed", commit: undefined as unknown as string})
			: real(s, m),
	"plant: forgetsMissingReview": forgetsMissingReview,
	"plant: skipsTheRead": skipsTheRead,
	"plant: takesAnOldVersion": takesAnOldVersion,
	"plant: keepsAnOldPass": keepsAnOldPass,
	"plant: landsAnyHead": landsAnyHead,
	"plant: actsAfterTheEnd": actsAfterTheEnd,
};

const tally = (seeds: readonly Seeded[]) => ({
	short: seeds.filter((x) => x.caught && x.ms <= SHORT_MS).length,
	long: seeds.filter((x) => x.caught).length,
	never: seeds.filter((x) => !x.caught && (x.never?.length ?? 0) > 0).length,
});
const brief = (x: Seeded) => ({
	seed: x.seed,
	caught: x.caught,
	ms: x.ms,
	runs: x.runs,
	law: x.law,
	why: x.why,
	steps: x.path?.length ?? null,
	path: x.path,
	never: x.never,
	redrawn: x.redrawn,
});

const plants = () =>
	Effect.gen(function* () {
		const out: Record<string, unknown> = {};
		for (const [name, update] of Object.entries(PLANTS)) {
			const seeds = yield* armC(update);
			out[name] = {...tally(seeds), seeds: seeds.map(brief)};
			const first = seeds.find((x) => x.caught);
			console.log(
				`${name}: ${JSON.stringify(tally(seeds))} ${first === undefined ? "" : `${first.law} in ${first.ms} ms, ${first.path?.length} steps`}`,
			);
		}
		const seeds = yield* armC(real);
		out["the real code"] = {
			...tally(seeds),
			seeds: seeds.map(brief),
			reach: seeds.map((x) => x.reach),
		};
		console.log(
			`the real code: ${JSON.stringify(tally(seeds))}, walks a seed ${seeds.map((x) => x.runs).join(", ")}`,
		);
		console.log(`never sent: ${JSON.stringify(seeds.map((x) => x.never))}`);
		mkdirSync(RUN, {recursive: true});
		writeFileSync(`${RUN}/plants.json`, JSON.stringify(out, null, "\t"));
	});

/** What the generator reaches on the real code, steered or not, for one seed. */
const reach = () =>
	Effect.gen(function* () {
		const x = yield* seedOf(real, 1);
		console.log(JSON.stringify({steer: STEER, size: SIZE, ...brief(x), ...x.reach}, null, 1));
		mkdirSync(RUN, {recursive: true});
		writeFileSync(
			`${RUN}/reach-steer${STEER ? 1 : 0}-size${SIZE}.json`,
			JSON.stringify({steer: STEER, size: SIZE, ...brief(x), reach: x.reach}, null, "\t"),
		);
	});

/** The gate's answer on drawn reads alone, by size: how often a read says go, wait or red, and how long one takes. */
const gates = () =>
	Effect.gen(function* () {
		const out: Record<string, unknown> = {};
		for (const size of [2, 4, 6, 10, 20, 30, 60]) {
			const started = performance.now();
			const xs = (yield* Arbitrary.sampleEffect(FACTS, {
				count: 5_000,
				size,
				seed: 1,
			})) as readonly ShipFacts[];
			const us = Math.round(((performance.now() - started) * 1000) / xs.length);
			const by = new Map<string, number>();
			for (const f of xs) {
				const g = shipGate(PR, f);
				bump(by, g.answer === "stop" ? nameOf(g.outcome) : g.answer);
			}
			out[size] = {us, ...Object.fromEntries([...by].sort((a, b) => b[1] - a[1]))};
		}
		console.log(JSON.stringify({steer: STEER, ...out}, null, 1));
		mkdirSync(RUN, {recursive: true});
		writeFileSync(`${RUN}/gates-steer${STEER ? 1 : 0}.json`, JSON.stringify(out, null, "\t"));
	});

/** Where a walk's time goes: drawing the inputs, Effect's check around them, the fold with the laws. */
const timing = () =>
	Effect.gen(function* () {
		const n = 100;
		const at = (started: number) => Number(((performance.now() - started) / n).toFixed(3));
		let started = performance.now();
		const xs = yield* Arbitrary.sampleEffect(EVENTS, {count: n, size: SIZE, seed: 1});
		const draw = at(started);
		started = performance.now();
		for (const es of xs) fold(real, es, reachOf());
		const folded = at(started);
		started = performance.now();
		yield* Arbitrary.checkEffect(EVENTS, () => true, {runs: n, size: SIZE, seed: "1"});
		const check = at(started);
		const out = {size: SIZE, msPerWalk: {draw, fold: folded, check}};
		console.log(JSON.stringify(out));
		mkdirSync(RUN, {recursive: true});
		writeFileSync(`${RUN}/timing-size${SIZE}.json`, JSON.stringify(out, null, "\t"));
	});

// ---------------------------------------------------------------- one mutant, as Stryker calls it

/** An arm's answer, or why there is none: it ran past its limit, or crashed. */
type Ran<T> =
	| {readonly ok: true; readonly why: null; readonly ms: number; readonly value: T}
	| {readonly ok: false; readonly why: string; readonly ms: number; readonly value: null};

/** A crash, said short, with repo-relative paths. */
const crashOf = (stderr: string): string => {
	const lines = stderr.split("\n").map((l) => l.trim());
	const i = lines.findIndex((l) => /^[A-Za-z]*Error\b/.test(l));
	const said = i < 0 ? (lines.filter((l) => l !== "").at(-1) ?? "") : lines[i];
	const at = i < 0 ? "" : (lines.slice(i + 1).find((l) => l.startsWith("at ")) ?? "");
	return `${said} ${at}`.replaceAll(`file://${ROOT}/`, "").replaceAll(ROOT, "").trim();
};

/** Run arm C in a child process, so a mutant that loops for good or blows up stops at a limit. */
const child = <T>(args: readonly string[], ms: number): Ran<T> => {
	const started = performance.now();
	// Node at this edge: a child process with a wall-time limit, which an Effect run cannot stop in sync code.
	const r = spawnSync(process.execPath, [import.meta.filename, ...args], {
		encoding: "utf8",
		timeout: ms,
		maxBuffer: 64 * 1024 * 1024,
		env: process.env,
	});
	const took = Math.round(performance.now() - started);
	const line = r.stdout?.trim().split("\n").at(-1) ?? "";
	if (r.error !== undefined || r.signal !== null)
		return {ok: false, why: "timeout", ms: took, value: null};
	if (r.status !== 0 || !line.startsWith("["))
		return {ok: false, why: `crash: ${crashOf(r.stderr)}`, ms: took, value: null};
	return {ok: true, why: null, ms: took, value: JSON.parse(line)};
};

const killed = (seeds: readonly Seeded[]) => ({
	law: seeds.some((x) => x.caught),
	never: seeds.some((x) => !x.caught && (x.never?.length ?? 0) > 0),
});

const mutant = () => {
	const id = process.env.__STRYKER_ACTIVE_MUTANT__ ?? "none";
	// Not in the sample: done at once, not counted. Already run (before the cut): not run again.
	if (id !== "none" && !SAMPLE.has(id) && !NAMED.includes(id)) return;
	const done = `${RUN}/rows/${id}.json`;
	if (id !== "none" && existsSync(done)) {
		const kept: {c: Ran<readonly Seeded[]>} = JSON.parse(readFileSync(done, "utf8"));
		const was = kept.c.ok ? killed(kept.c.value) : {law: true, never: false};
		process.exitCode = was.law || was.never ? 1 : 0;
		return;
	}
	const c = child<readonly Seeded[]>(["arm"], ARM_MS);
	// A crash (the module does not load, say) fails the test, so mutation testing counts it as killed.
	const k = c.ok ? killed(c.value) : {law: true, never: false};
	mkdirSync(`${RUN}/rows`, {recursive: true});
	writeFileSync(
		`${RUN}/rows/${id}.json`,
		JSON.stringify({
			id,
			c: c.ok ? {...c, value: c.value.map(({reach: _, ...x}) => ({...x, sent: _.sent}))} : c,
		}),
	);
	console.log(
		`mutant ${id}: ${k.law ? "killed by a law" : k.never ? "killed by never sent" : "survived"}`,
	);
	process.exitCode = k.law || k.never ? 1 : 0;
};

// ---------------------------------------------------------------- Stryker, and the report

const run = () => {
	const stryker = process.env.STRYKER;
	if (stryker === undefined) throw new Error("set STRYKER to the stryker binary");
	mkdirSync(RUN, {recursive: true});
	const config = {
		$schema:
			"https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/packages/core/schema/stryker-schema.json",
		testRunner: "command",
		commandRunner: {command: "node experiments/120-schema-property-tests.ts mutant"},
		mutate: FILES,
		inPlace: true,
		// Node strips types and checks none, so no file needs a `// @ts-nocheck` (119 had ~746 of them).
		disableTypeChecks: false,
		concurrency: Number(env("CONCURRENCY", "8")),
		coverageAnalysis: "off",
		timeoutMS: 30 * 60_000,
		timeoutFactor: 4,
		dryRunTimeoutMinutes: 30,
		reporters: ["json", "clear-text", "progress"],
		jsonReporter: {fileName: "runs/120/ship.mutation.json"},
		tempDirName: "runs/120/stryker-tmp",
		cleanTempDir: true,
	};
	const path = `${RUN}/ship.stryker.json`;
	writeFileSync(path, JSON.stringify(config, null, "\t"));
	const r = spawnSync(stryker, ["run", path], {cwd: ROOT, stdio: "inherit", env: process.env});
	if (r.status !== 0) throw new Error("stryker failed");
};

interface StrykerMutant {
	readonly id: string;
	readonly mutatorName: string;
	readonly replacement?: string;
	readonly status: string;
	readonly location: {readonly start: {readonly line: number}};
}
interface Row119 {
	readonly id: string;
	readonly line: number;
	readonly mutator: string;
	readonly to: string;
	readonly kind: string;
	readonly why?: string;
	readonly a?: {
		readonly killed: boolean;
		readonly why?: string;
		readonly failed?: readonly {readonly check: string; readonly law: string}[];
	};
	readonly b?: {
		readonly plain?: {readonly short: number; readonly long: number};
		readonly first?: {readonly ms: number} | null;
	};
}

const median = (xs: readonly number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0 ? null : (s[Math.floor((s.length - 1) / 2)] as number);
};
const short = (s: string, n = 160) => {
	const one = s.replace(/\s+/g, " ").trim();
	return one.length > n ? `${one.slice(0, n)}...` : one;
};

/** Lines between `// ---- lines: <name>` and `// ---- end`, not counting blank lines or comments. */
const linesOf = (source: string): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const m of source.matchAll(/\/\/ ---- lines: ([\w ]+)\n([\s\S]*?)\/\/ ---- end/g))
		out[m[1] as string] = code(m[2] as string);
	return out;
};
const code = (text: string) =>
	text.split("\n").filter((l) => {
		const t = l.trim();
		return t !== "" && !t.startsWith("//") && !t.startsWith("/**") && !t.startsWith("*");
	}).length;
/** Code lines of `file`, from the line holding `from` to the line before the one holding `to` (or the end). */
const span = (file: string, from: string, to: string | null) => {
	const lines = readFileSync(`${ROOT}/${file}`, "utf8").split("\n");
	const a = lines.findIndex((l) => l.includes(from));
	const b = to === null ? lines.length : lines.findIndex((l, i) => i > a && l.includes(to));
	return code(lines.slice(a, b).join("\n"));
};

const report = () => {
	const stryker = JSON.parse(readFileSync(`${RUN}/ship.mutation.json`, "utf8"));
	const old: readonly Row119[] = JSON.parse(readFileSync(B119, "utf8")).mutants;
	const oldById = new Map(old.map((m) => [m.id, m]));
	const joined = [];
	for (const [path, entry] of Object.entries(
		stryker.files as Record<string, {mutants: StrykerMutant[]}>,
	))
		for (const m of entry.mutants) {
			if (!SAMPLE.has(m.id) && !NAMED.includes(m.id)) continue;
			const b119 = oldById.get(m.id);
			// The same edit at the same place, or the ids do not match 119's.
			const same =
				b119 !== undefined &&
				b119.line === m.location.start.line &&
				b119.mutator === m.mutatorName &&
				b119.to === short(m.replacement ?? "");
			const rowFile = `${RUN}/rows/${m.id}.json`;
			const row = readdirSync(`${RUN}/rows`).includes(`${m.id}.json`)
				? JSON.parse(readFileSync(rowFile, "utf8"))
				: null;
			const c: Ran<readonly Seeded[]> | null = row?.c ?? null;
			const k =
				c === null
					? {law: m.status === "Killed", never: false}
					: c.ok
						? killed(c.value)
						: {law: true, never: false};
			const cKilled = k.law || k.never;
			// 119's B, plain walks only. A mutant that stops the module loading has no row there: both kill it.
			const bKilled =
				b119 === undefined
					? null
					: b119.b?.plain === undefined
						? b119.kind === "both"
						: b119.b.plain.long > 0;
			const kind =
				bKilled === null
					? "no 119"
					: bKilled && cKilled
						? "both"
						: bKilled
							? "only B"
							: cKilled
								? "only C"
								: "neither";
			const caught = c?.ok === true ? c.value.find((x) => x.caught) : undefined;
			joined.push({
				id: m.id,
				file: path.replace(`${ROOT}/`, ""),
				line: m.location.start.line,
				mutator: m.mutatorName,
				to: short(m.replacement ?? ""),
				stryker: m.status,
				same,
				kind,
				/** Without the never-sent check: a law only. */
				kindLawOnly:
					bKilled === null
						? "no 119"
						: bKilled && k.law
							? "both"
							: bKilled
								? "only B"
								: k.law
									? "only C"
									: "neither",
				c:
					c === null
						? {why: "no row: the module does not load"}
						: c.ok
							? {
									killedBy: k.law ? "law" : k.never ? "never sent" : null,
									...tally(c.value),
									ms: c.ms,
									first:
										caught === undefined
											? null
											: {
													seed: caught.seed,
													ms: caught.ms,
													runs: caught.runs,
													law: caught.law,
													why: caught.why === null ? null : short(caught.why, 240),
													steps: caught.path?.length ?? null,
													path: caught.path,
												},
									never: [...new Set(c.value.flatMap((x) => x.never ?? []))],
									walks: c.value.map((x) => x.runs),
								}
							: {killedBy: "crash", why: c.why, ms: c.ms},
				b119:
					b119 === undefined
						? null
						: {
								kind: b119.kind,
								bPlain: b119.b?.plain ?? null,
								aKilled: b119.a?.killed ?? null,
								aCrashed: b119.a?.why !== undefined,
								aLaws: b119.a?.failed?.map((f) => `${f.check}: ${f.law}`) ?? null,
								why: b119.why ?? null,
							},
			});
		}
	const mutants = joined.filter((m) => SAMPLE.has(m.id));
	const named = joined.filter((m) => NAMED.includes(m.id));
	const count = (k: string, key: "kind" | "kindLawOnly" = "kind", of = mutants) =>
		of.filter((m) => m[key] === k).length;
	const kinds = (of: typeof mutants) => ({
		mutants: of.length,
		in119: {
			both: of.filter((m) => m.b119?.kind === "both").length,
			neither: of.filter((m) => m.b119?.kind === "neither").length,
		},
		both: count("both", "kind", of),
		onlyB: count("only B", "kind", of),
		onlyC: count("only C", "kind", of),
		neither: count("neither", "kind", of),
		lawOnly: {
			both: count("both", "kindLawOnly", of),
			onlyB: count("only B", "kindLawOnly", of),
			onlyC: count("only C", "kindLawOnly", of),
			neither: count("neither", "kindLawOnly", of),
		},
	});
	const byFile = Object.fromEntries(
		FILES.map((f) => [f.split("/").at(-1), kinds(mutants.filter((m) => m.file === f))]),
	);
	const rows = mutants.filter((m) => "ms" in m.c && typeof m.c.ms === "number");
	const ms = (pred: (m: (typeof mutants)[number]) => boolean) =>
		rows.filter(pred).map((m) => (m.c as {ms: number}).ms);
	const cOk = (m: (typeof mutants)[number]) => "killedBy" in m.c && m.c.killedBy !== null;
	const time = {
		medianCaughtMs: median(ms(cOk)),
		medianNotCaughtMs: median(ms((m) => !cOk(m))),
		totalMs: ms(() => true).reduce((a, b) => a + b, 0),
		/** Where a law caught it: the first seed's time to the catch. */
		medianFirstCatchMs: median(
			mutants.flatMap((m) => ("first" in m.c && m.c.first !== null ? [m.c.first.ms] : [])),
		),
	};
	const self = readFileSync(import.meta.filename, "utf8");
	const ours = linesOf(self);
	const theirs = {
		"ship world (laws/ship.ts, PR to shipWorld's end)": span(
			"packages/pipeline/src/laws/ship.ts",
			"export const PR",
			"const writes",
		),
		"lanes world (laws/world/lanes.ts)": span(
			"packages/pipeline/src/laws/world/lanes.ts",
			"import",
			null,
		),
		"walk.ts, one machine (to the world part)": span(
			"packages/pipeline/src/laws/walk.ts",
			"export interface Walked",
			"// ---------------------------------------------------------------- a world of machines",
		),
		"walk.ts, worlds": span(
			"packages/pipeline/src/laws/walk.ts",
			"// ---------------------------------------------------------------- a world of machines",
			null,
		),
		"sample.ts": span("packages/pipeline/src/laws/sample.ts", "import", null),
	};
	const total = {
		...kinds(mutants),
		no119: count("no 119"),
		idsMatch119: mutants.filter((m) => m.same).length,
		byFile,
		cKilledBy: {
			law: mutants.filter((m) => "killedBy" in m.c && m.c.killedBy === "law").length,
			never: mutants.filter((m) => "killedBy" in m.c && m.c.killedBy === "never sent").length,
			crash: mutants.filter((m) => "killedBy" in m.c && m.c.killedBy === "crash").length,
			noLoad: mutants.filter((m) => !("killedBy" in m.c)).length,
		},
	};
	console.log(
		JSON.stringify(
			{
				total,
				time,
				lines: {ours, theirs},
				named: named.map((m) => ({id: m.id, kind: m.kind, c: m.c})),
			},
			null,
			2,
		),
	);
	const sample = {
		seed: 119120,
		ids: [...SAMPLE].map(Number),
		why: "cut from 569 for cost and noise",
	};
	writeFileSync(
		OUT,
		`${JSON.stringify({effect: "4.0.6", budgetMs: BUDGET_MS, shortMs: SHORT_MS, seeds: SEEDS, length: LENGTH, size: SIZE, lean: LEAN, fails: FAILS, after: AFTER, files: FILES, sample, total, time, lines: {ours, theirs}, named, mutants}, null, "\t")}\n`
			.replaceAll(`file://${ROOT}/`, "")
			.replaceAll(`${ROOT}/`, ""),
	);
	console.log("wrote experiments/results/120-schema-property-tests.json");
};

// ---------------------------------------------------------------- main

const [mode] = process.argv.slice(2);
// Node at this edge: the runtime runs each mode, and `arm` prints its answer for the parent.
if (mode === "arm") console.log(JSON.stringify(await Effect.runPromise(armC(real))));
else if (mode === "reach") await Effect.runPromise(reach());
else if (mode === "gates") await Effect.runPromise(gates());
else if (mode === "timing") await Effect.runPromise(timing());
else if (mode === "plants") await Effect.runPromise(plants());
else if (mode === "mutant") mutant();
else if (mode === "run") run();
else if (mode === "report") report();
else throw new Error("mode: reach, plants, run, report, mutant, arm");
