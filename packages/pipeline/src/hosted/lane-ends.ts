// Does the hosted lane end once its children have ended? (experiment 116). A property, checked on
// the real code: the hosted lane (./lane.ts) and the real host (`serve`, `cast`) on the in-memory
// ledger, the way ./deliver.ts serves them. What stands in: the children, and the code host.
//
//   a child     a stand-in program under the name the lane gives it. It does one of three things,
//               as the generated list says: writes a `done` row and exits, writes a `stuck` row and
//               exits, or exits (a crash) with no row. Past the list's end, a child writes `stuck`,
//               so every run has an end the lane can see
//   the world   one approved plan on the ledger (the first of experiment 86b's); a code host with
//               no branch and no pull request, so the lane's read touches no git
//   the clock   Effect's TestClock: every 150 ms poll in the lane and the host is virtual time,
//               so a case runs in a few real milliseconds
//   the law     the lane writes its outcome row within `limitMs` of virtual time after its last
//               child ended
//
// Two lanes: `today`, ./lane.ts as it is, and `fixed`, the same lane with only its child Sub
// swapped for one that also ends when the child is down (as experiment 115 sketched): then it
// reads the row once more, and a missing row is `stuck:no_outcome`. ./lane.ts is not changed.

import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {
	cast,
	defineProgram,
	envelope,
	input,
	Ledger,
	type ProcessInfo,
	Self,
	serve,
} from "@kampus/fabrika";
import {Arbitrary, Clock, Duration, Effect, Exit, Layer, Schedule, Schema, Stream} from "effect";
import {TestClock} from "effect/testing";
import {plans86b} from "../asks/cases.ts";
import type {Fact} from "../asks/ledger.ts";
import {ensureName, memoryLedger} from "../asks/ledger.ts";
import {planAskId} from "../asks/rules.ts";
import {planOf, ticketId} from "../ids.ts";
import {ChildEnd, type LaneJob, type LaneMsg, type LaneSub} from "../stages/lane/machine.ts";
import {revisionOfDraft} from "../stages/plan/plan.ts";
import {BuildWork} from "./build.ts";
import {serveChildren} from "./children.ts";
import {noFaults} from "./idempotency.ts";
import {hostedLane, laneOf} from "./lane.ts";
import {Outside} from "./outside.ts";
import {hostedStage, outcomeOf, readOutcome} from "./stage.ts";

/** How one child ends. */
export const Ending = Schema.Literals(["row_done", "row_stuck", "no_row"]);
export type Ending = typeof Ending.Type;

/** Which lane runs: ./lane.ts as it is, or with the child Sub that also ends on the child's end. */
export type Variant = "today" | "fixed";

/** What one case saw. */
export interface Seen {
	/** The lane wrote its outcome row in time. */
	readonly ended: boolean;
	readonly outcome: unknown;
	/** Each child the lane started, in order, and how it ended. */
	readonly children: readonly {readonly name: string; readonly ending: Ending}[];
	/** Virtual milliseconds from the start to the lane's row, or to giving up. */
	readonly ms: number;
}

const HOLDER = "host-a";
/** Long, so a lease never ends on the wall clock while the test clock runs. */
const TTL_MS = 3_600_000;
const TICK = Duration.millis(50);
const EVERY = Schedule.spaced(Duration.millis(150));
const decodeEnd = Schema.decodeUnknownExit(ChildEnd);

const plan = (() => {
	const first = plans86b().find((p) => p.plan !== null);
	const data = first?.plan == null ? null : revisionOfDraft(first.plan);
	if (first === undefined || data === null) throw new Error("experiment 86b's first plan is gone");
	const ticket = ticketId(first.ticket);
	const id = planOf(ticket);
	const facts: readonly Fact[] = [
		{type: "planned", plan: id, tickets: [ticket], data, problems: []},
		{type: "answered", id: planAskId(id, 1), answer: {kind: "approve"}},
	];
	return {id, facts};
})();

const job: LaneJob = {
	plan: plan.id,
	settings: {model: "haiku", effort: "low", budget: 1},
	usd: 1,
	rubrics: "rubrics",
	at: 1_800_000_000,
};

/** A code host with no branch and no pull request yet. Any write is a defect: the lane makes none here. */
const outside = Layer.succeed(Outside, {
	branchHead: (_repo, branch) => Effect.succeed(branch === "main" ? "main0" : null),
	prFrom: () => Effect.succeed(null),
	hasComment: () => Effect.succeed(false),
	landing: () => Effect.succeed({at: "none"} as const),
	remote: () => "memory://none",
	push: () => Effect.die("no push in this world"),
	open: () => Effect.die("no pull request in this world"),
	comment: () => Effect.die("no comment in this world"),
	enqueue: () => Effect.die("no queue in this world"),
	merge: () => Effect.die("no merge in this world"),
	rerunChecks: () => Effect.die("no checks in this world"),
});
const work = Layer.succeed(BuildWork, {dir: "", env: {}, install: false});

// ---------------------------------------------------------------- the fixed lane, built here

/**
 * The child Sub as experiment 115 sketched its fix: it ends on the row, or on the child being down
 * (the same fact the trapped EXIT carries). Then it reads the row once more, so a row written just
 * before the exit is still read; none is `stuck:no_outcome`, as ./lane.ts says a row it cannot read.
 */
const fixedChild =
	(reads: Self["Service"]["reads"]) =>
	(sub: Extract<LaneSub, {type: "lane_child"}>): Stream.Stream<LaneMsg> => {
		const row = reads.readStream(outcomeOf(sub.deps.child)).pipe(
			Effect.map((rows) => rows.find((r) => r.id === "outcome") ?? null),
			Effect.orElseSucceed(() => null),
		);
		const down = reads.processInfo(sub.deps.child).pipe(
			Effect.map((p: ProcessInfo | null) => p !== null && p.down !== 0),
			Effect.orElseSucceed(() => false),
		);
		const look = Effect.gen(function* () {
			const now = yield* row;
			if (now !== null) return now;
			if (!(yield* down)) return undefined;
			return yield* row;
		});
		const decodeRow = Schema.decodeUnknownExit(
			Schema.fromJsonString(Schema.Struct({outcome: Schema.Unknown})),
		);
		return Stream.fromEffect(
			look.pipe(
				Effect.repeat({until: (r) => r !== undefined, schedule: EVERY}),
				Effect.map((r): LaneMsg => {
					const data = r == null ? null : decodeRow(r.data);
					const end = data !== null && Exit.isSuccess(data) ? decodeEnd(data.value.outcome) : null;
					return end !== null && Exit.isSuccess(end)
						? {type: "child_over", child: sub.deps.child, end: end.value}
						: {
								type: "child_over",
								child: sub.deps.child,
								end: {outcome: {kind: "stuck", why: "no_outcome"}},
							};
				}),
			),
		);
	};

/** ./lane.ts's stage with only its child Sub swapped: the machine and every handler are its own. */
export const fixedLane: typeof hostedLane = {
	...hostedLane,
	boot: (self) => {
		const run: typeof self.run = (machine, journal, opts) =>
			self.run(machine, journal, {
				...opts,
				subscribe: {...opts.subscribe, lane_child: fixedChild(self.reads)},
			} as typeof opts);
		return hostedLane.boot({...self, run});
	},
};

const laneOfVariant = (v: Variant): typeof hostedLane => (v === "today" ? hostedLane : fixedLane);

// ---------------------------------------------------------------- the stand-in children

const childProgram = (
	endingOf: (name: string) => Ending,
	ended: (name: string, at: number) => void,
) =>
	defineProgram({
		name: "stand-in-child",
		description: "A lane's child that writes its outcome row, or not, then exits.",
		inputs: {inbox: input(envelope(Schema.Unknown), "The job, unread.")},
		outputs: {},
		main: () =>
			Effect.gen(function* () {
				const self = yield* Self;
				const ledger = yield* Ledger;
				const ending = endingOf(self.name);
				if (ending !== "no_row") {
					const outcome =
						ending === "row_done"
							? {outcome: {kind: "done"}, head: null}
							: {outcome: {kind: "stuck", why: "planted"}};
					yield* ledger
						.append(
							outcomeOf(self.name),
							"any",
							{kind: "outcome", writer: self.holder, id: "outcome", data: {outcome}},
							self.fence,
						)
						.pipe(Effect.orDie);
				}
				yield* self.exit(ending === "no_row" ? "crash" : "normal", `stand-in: ${ending}`);
				const at = yield* Clock.currentTimeMillis;
				yield* Effect.sync(() => ended(self.name, at));
				return yield* Effect.never;
			}),
	});

// ---------------------------------------------------------------- one case

/**
 * Run one lane whose children end as `endings` says, in the order the lane starts them, until the
 * lane writes its outcome row or `limitMs` of virtual time pass with every child it started ended.
 */
export const runCase = (o: {
	readonly endings: readonly Ending[];
	readonly variant: Variant;
	readonly limitMs: number;
	/** Virtual time at which a case gives up whatever happens. */
	readonly capMs?: number;
}): Effect.Effect<Seen> =>
	Effect.gen(function* () {
		const children: {name: string; ending: Ending}[] = [];
		const up = new Set<string>();
		let lastEnd = 0;
		const endingOf = (name: string): Ending => {
			const ending = o.endings[children.length] ?? "row_stuck";
			children.push({name, ending});
			up.add(name);
			return ending;
		};
		const ended = (name: string, at: number) => {
			up.delete(name);
			lastEnd = at;
		};
		const lane = laneOf(plan.id);
		const say = () => {};
		const stage = laneOfVariant(o.variant);
		const program = childProgram(endingOf, ended);

		yield* ensureName(lane, HOLDER);
		yield* cast(lane, "job", job, HOLDER);
		const timing = {holder: HOLDER, ttlMs: TTL_MS, renewEveryMs: TTL_MS / 4};
		yield* serve({name: lane, program: hostedStage(stage, say), ...timing}).pipe(Effect.orDie);
		yield* serveChildren(lane, (child) =>
			serve({name: child, program, ...timing}).pipe(Effect.orDie),
		);

		const cap = o.capMs ?? 120_000;
		const start = yield* Clock.currentTimeMillis;
		for (;;) {
			yield* TestClock.adjust(TICK);
			for (let k = 0; k < 20; k++) yield* Effect.yieldNow;
			const now = yield* Clock.currentTimeMillis;
			const row = yield* readOutcome(lane).pipe(Effect.orElseSucceed(() => null));
			if (row !== null) return {ended: true, outcome: row.outcome, children, ms: now - start};
			const quiet = children.length > 0 && up.size === 0 && now - lastEnd > o.limitMs;
			if (quiet || now - start > cap)
				return {ended: false, outcome: null, children, ms: now - start};
		}
	}).pipe(
		Effect.scoped,
		Effect.provide(
			Layer.mergeAll(
				memoryLedger(plan.facts).layer,
				outside,
				work,
				noFaults,
				nodeServices,
				TestClock.layer(),
			),
		),
	);

// ---------------------------------------------------------------- the property

/** How long, in virtual time, the lane may take to end after its last child ended. */
export const LIMIT_MS = 5_000;

/** Up to six children's endings, of the kinds given. Effect's own Arbitrary, so it shrinks. */
export const endingsOf = (kinds: readonly Ending[] = Ending.literals) =>
	Arbitrary.array(Arbitrary.schema(Schema.Literals(kinds)), {maxLength: 6});

/**
 * No child that wrote its row was ended as `no_outcome`: the lane read every row there was. The
 * doubt experiment 115 left on its fix, a row written just before the exit and missed.
 */
export const rowsRead = (seen: Seen): boolean => {
	const report = (seen.outcome as {report?: {problems?: readonly string[]}} | null)?.report;
	return seen.children.every(
		(k) => k.ending === "no_row" || !(report?.problems ?? []).includes(`${k.name}: no_outcome`),
	);
};

/**
 * The law, checked on generated endings: the lane ends within `LIMIT_MS` after its children did.
 * `rows`: and it read every row a child wrote (`rowsRead`).
 */
export const laneEnds = (
	variant: Variant,
	o: {
		readonly kinds?: readonly Ending[];
		readonly rows?: boolean;
		readonly check?: Arbitrary.CheckOptions;
	} = {},
) =>
	Arbitrary.checkEffect(
		endingsOf(o.kinds),
		(endings) =>
			runCase({endings, variant, limitMs: LIMIT_MS}).pipe(
				Effect.map((seen) => seen.ended && (o.rows !== true || rowsRead(seen))),
			),
		o.check,
	);
