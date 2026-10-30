import {
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import type {MsgOf} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import {openJobs, TABLE} from "./host-jobs.ts";
import {EMPTY, Job, Jobs, jobsMachine, type StageRecord} from "./jobs.ts";

// The laws of the host's job table (moved here from tsh with the table), on tea's pbt: after every step of any list of Msgs, from the real
// init. A job begins as tsh says it does: every program in it running. The rest comes in any
// order, numbers and run ids that name no job included, as a tsh that crashed and came back may
// send them.

type Machine = typeof jobsMachine;
type Msg = MsgOf<Machine>;

const run = fc.constantFrom("r1", "r2", "r3", "r4", "r5", "r6");
const stage: fc.Arbitrary<StageRecord> = fc.record({
	program: fc.constantFrom("counter", "seq", "say"),
	flags: fc.constant({}),
	run,
	wire: fc.constant(null),
	ended: fc.constant(false),
});
const n = fc.integer({min: 1, max: 4});
/** Two tiles' tsh, and a tsh with no name. */
const owner = fc.constantFrom("t1", "t2", null);

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	began: arbRecordMsg("began", {
		text: fc.constantFrom("counter", "seq --to 3 | say", "counter &"),
		stages: fc
			.tuple(stage, fc.array(stage, {maxLength: 2}))
			.map(([first, rest]) => [first, ...rest] as const),
		background: fc.boolean(),
		owner,
	}),
	stage_ended: arbRecordMsg("stage_ended", {
		run,
		how: fc.constantFrom("done", "failed", "stopped"),
	}),
	detached: arbRecordMsg("detached", {n: fc.option(n, {nil: null})}),
	attached: arbRecordMsg("attached", {n, background: fc.boolean(), owner}),
	foreground: arbRecordMsg("foreground", {n}),
	dropped: arbRecordMsg("dropped", {n}),
};
/** Long lists, so jobs pile up, leave and come back. Not tea's `arbMsgSequence`: its lists come out about ten long. */
const lists = fc.array(arbMsg(table, {weights: {began: 3, stage_ended: 4, detached: 1}}), {
	maxLength: 40,
	size: "max",
});
const OPTS = {numRuns: 400, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

type JobStep = Step<Jobs, Msg, never>;

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

/** A law over each step, from a fresh table and from a kept one. */
const everyStep = (name: string, holds: (step: JobStep) => boolean): Law => ({
	name,
	check: (machine) => {
		propertyInvariant(machine, ctx, lists, holds, OPTS);
		propertyInvariant(machine, ctx, lists, holds, {...OPTS, loaded: KEPT});
	},
});

const byNumber = (s: Jobs, at: number): Job | undefined => s.jobs.find((job) => job.n === at);
const live = (job: Job): boolean => job.stages.some((st) => !st.ended);
/** Would this run's end end the job: it is in the job, and every other program has ended? */
const lastOf = (job: Job, run: string): boolean =>
	job.stages.some((st) => st.run === run) && job.stages.every((st) => st.ended || st.run === run);

/** A table an earlier host kept: t1's job detached with a program ended, t2's running in the background, and 2 and 4 gone. */
const KEPT: Jobs = {
	next: 5,
	jobs: [
		{
			n: 1,
			text: "seq --to 3 | say",
			stages: [
				{program: "seq", flags: {}, run: "r1", wire: {output: "out", input: "in"}, ended: true},
				{program: "say", flags: {}, run: "r2", wire: null, ended: false},
			],
			state: "detached",
			background: false,
			owner: "t1",
		},
		{
			n: 3,
			text: "counter &",
			stages: [{program: "counter", flags: {}, run: "r3", wire: null, ended: false}],
			state: "running",
			background: true,
			owner: "t2",
		},
	],
};

// ---------------------------------------------------------------- never wrong

const numbersOnce = everyStep(
	"no two jobs have the same number, and every number is 1 or more",
	({next}) => {
		const ns = next.jobs.map((job) => job.n);
		return new Set(ns).size === ns.length && ns.every((at) => at >= 1);
	},
);

const numbered = everyStep(
	"a line that begins is a new job at the end, running, numbered the table's next, and next goes up by one; nothing else changes, and no other Msg moves next",
	({prev, msg, next}) => {
		if (msg.type !== "began") return next.next === prev.next;
		const made: Job = {
			n: prev.next,
			text: msg.text,
			stages: msg.stages,
			state: "running",
			background: msg.background,
			owner: msg.owner,
		};
		return (
			next.next === prev.next + 1 &&
			JSON.stringify(next.jobs) === JSON.stringify([...prev.jobs, made])
		);
	},
);

/**
 * Across a whole list of Msgs, not one step: a number a job ever had, in the table it started
 * from or since, is never given to a job that begins later. As WezTerm's and tmux's ids, so a
 * `%2` read an hour ago names the same job or none.
 */
const neverReused: Law = {
	name: "a job's number is never given to another job, across any list of Msgs",
	check: (machine) => {
		const holds = (loaded: Jobs | null) =>
			fc.assert(
				fc.property(lists, (list) => {
					const {states, steps} = foldEvents(machine, ctx, loaded, list);
					const had = new Set((states[0]?.jobs ?? []).map((job) => job.n));
					for (const {msg, next} of steps) {
						const made = msg.type === "began" ? next.jobs.at(-1) : undefined;
						if (made !== undefined && had.has(made.n)) return false;
						for (const job of next.jobs) had.add(job.n);
					}
					return true;
				}),
				OPTS,
			);
		holds(null);
		holds(KEPT);
	},
};

const detachedWaits = everyStep(
	"a detached job is not touched by a program's end or by fg: only attach and drop change it",
	({prev, msg, next}) =>
		(msg.type !== "stage_ended" && msg.type !== "foreground") ||
		prev.jobs
			.filter((job) => job.state === "detached")
			.every((job) => JSON.stringify(byNumber(next, job.n)) === JSON.stringify(job)),
);

const leavesRightly = everyStep(
	"a job leaves the table only when its last program ended, or when a detached job is dropped",
	({prev, msg, next}) =>
		prev.jobs
			.filter((job) => byNumber(next, job.n) === undefined)
			.every((job) =>
				msg.type === "stage_ended"
					? job.state === "running" && lastOf(job, msg.run)
					: msg.type === "dropped" && msg.n === job.n && job.state === "detached",
			),
);

const runningLive = everyStep("a running job always has a program still running", ({next}) =>
	next.jobs.every((job) => job.state !== "running" || live(job)),
);

const backgroundByAsk = everyStep(
	"a job goes to the background or the foreground only when tsh says so: attach, or fg",
	({prev, msg, next}) =>
		prev.jobs.every((job) => {
			const now = byNumber(next, job.n);
			if (now === undefined || now.background === job.background) return true;
			if (msg.type === "attached") return msg.n === job.n && now.background === msg.background;
			return msg.type === "foreground" && msg.n === job.n && !now.background;
		}),
);

const ownerByAsk = everyStep(
	"a job is the tsh's that began it, or last attached it: no other Msg moves it to another",
	({prev, msg, next}) =>
		prev.jobs.every((job) => {
			const now = byNumber(next, job.n);
			if (now === undefined || now.owner === job.owner) return true;
			return (
				msg.type === "attached" &&
				msg.n === job.n &&
				job.state === "detached" &&
				now.owner === msg.owner
			);
		}),
);

// ---------------------------------------------------------------- something good

const fgWaits = everyStep(
	"fg on a running job brings it to the foreground",
	({prev, msg, next}) =>
		msg.type !== "foreground" ||
		byNumber(prev, msg.n)?.state !== "running" ||
		byNumber(next, msg.n)?.background === false,
);

const attachRuns = everyStep(
	"attach on a detached job runs it again: same number, line and runs, every program running",
	({prev, msg, next}) => {
		if (msg.type !== "attached") return true;
		const was = byNumber(prev, msg.n);
		if (was?.state !== "detached") return true;
		const now = byNumber(next, msg.n);
		return (
			now !== undefined &&
			now.state === "running" &&
			now.text === was.text &&
			now.background === msg.background &&
			now.owner === msg.owner &&
			now.stages.length === was.stages.length &&
			now.stages.every((st, at) => st.run === was.stages[at]?.run && !st.ended)
		);
	},
);

const lastEndLeaves = everyStep(
	"when the last program of a running job ends, the job leaves the table",
	({prev, msg, next}) =>
		msg.type !== "stage_ended" ||
		prev.jobs
			.filter((job) => job.state === "running" && lastOf(job, msg.run))
			.every((job) => byNumber(next, job.n) === undefined),
);

const dropLeaves = everyStep(
	"a detached job that is dropped leaves the table",
	({prev, msg, next}) =>
		msg.type !== "dropped" ||
		byNumber(prev, msg.n)?.state !== "detached" ||
		byNumber(next, msg.n) === undefined,
);

const keptComesBack: Law = {
	name: "a tsh started again finds every job the last one kept, as it was",
	check: (machine) => {
		const [s] = machine.init(KEPT, undefined);
		if (JSON.stringify(s) !== JSON.stringify(KEPT))
			throw new Error(`came back as ${JSON.stringify(s)}`);
	},
};

const LAWS = [
	numbersOnce,
	numbered,
	neverReused,
	detachedWaits,
	leavesRightly,
	runningLive,
	backgroundByAsk,
	ownerByAsk,
	fgWaits,
	attachRuns,
	lastEndLeaves,
	dropLeaves,
	keptComesBack,
];

/** The names of the laws `machine` breaks. */
const broken = (machine: Machine): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// ---------------------------------------------------------------- planted mistakes

const real = jobsMachine.update;
/** The stages, with the programs of this run marked ended. */
const endedIn = (stages: Job["stages"], at: string): Job["stages"] => {
	const mark = (st: StageRecord): StageRecord => (st.run === at ? {...st, ended: true} : st);
	const [first, ...rest] = stages;
	return [mark(first), ...rest.map(mark)];
};
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...jobsMachine,
	update: {...real, ...update},
});

const PLANTS = {
	/** A new job is numbered by how many jobs there are, so a freed number is given twice. */
	countsForNumbers: plant({
		began: (s, m) => {
			const [next] = real.began(s, m);
			const made = next.jobs.at(-1);
			if (made === undefined) return [next, []];
			return [{...next, jobs: [...s.jobs, {...made, n: s.jobs.length + 1}]}, []];
		},
	}),
	/**
	 * The rule before `next`: a new job takes the lowest number no job has now, so the number of a
	 * job that ended is given again, and `next` follows it.
	 */
	lowestFree: plant({
		began: (s, m) => {
			const [next] = real.began(s, m);
			const made = next.jobs.at(-1);
			if (made === undefined) return [next, []];
			const taken = new Set(s.jobs.map((job) => job.n));
			let free = 1;
			while (taken.has(free)) free += 1;
			return [{jobs: [...s.jobs, {...made, n: free}], next: free + 1}, []];
		},
	}),
	/** A program's end is marked on a detached job too. */
	endsDetached: plant({
		stage_ended: (s, m) => {
			const [next] = real.stage_ended(s, m);
			const mark = (job: Job): Job =>
				job.state !== "detached" ? job : {...job, stages: endedIn(job.stages, m.run)};
			return [{...next, jobs: next.jobs.map(mark)}, []];
		},
	}),
	/** A job leaves at the end of its first program. */
	leavesEarly: plant({
		stage_ended: (s, m) => [
			{
				...s,
				jobs: s.jobs.filter(
					(job) => job.state !== "running" || !job.stages.some((st) => st.run === m.run),
				),
			},
			[],
		],
	}),
	/** drop takes a running job too. */
	dropsRunning: plant({
		dropped: (s, m) => [{...s, jobs: s.jobs.filter((job) => job.n !== m.n)}, []],
	}),
	/** A job whose programs all ended stays in the table. */
	keepsEnded: plant({
		stage_ended: (s, m) => [
			{
				...s,
				jobs: s.jobs.map((job) =>
					job.state !== "running" ? job : {...job, stages: endedIn(job.stages, m.run)},
				),
			},
			[],
		],
	}),
	/** detach puts the job in the foreground. */
	detachForgetsBackground: plant({
		detached: (s, m) => {
			const [next] = real.detached(s, m);
			return [
				{
					...next,
					jobs: next.jobs.map((job) =>
						job.state === "detached" ? {...job, background: false} : job,
					),
				},
				[],
			];
		},
	}),
	/** fg does nothing. */
	deafToFg: plant({foreground: (s) => [s, []]}),
	/** attach runs the job again with the programs that ended still marked ended. */
	attachKeepsEnded: plant({
		attached: (s, m) => [
			{
				...s,
				jobs: s.jobs.map((job) =>
					job.n === m.n && job.state === "detached"
						? {...job, state: "running" as const, background: m.background}
						: job,
				),
			},
			[],
		],
	}),
	/** attach runs the job again, still the tsh's that ran it before. */
	attachKeepsOwner: plant({
		attached: (s, m) => {
			const [next] = real.attached(s, m);
			return [
				{
					...next,
					jobs: next.jobs.map((job) => {
						const was = s.jobs.find((one) => one.n === job.n);
						return was === undefined ? job : {...job, owner: was.owner};
					}),
				},
				[],
			];
		},
	}),
	/** detach forgets whose the job was. */
	detachForgetsOwner: plant({
		detached: (s, m) => {
			const [next] = real.detached(s, m);
			return [
				{
					...next,
					jobs: next.jobs.map((job) => (job.state === "detached" ? {...job, owner: null} : job)),
				},
				[],
			];
		},
	}),
	/** drop does nothing. */
	deafToDrop: plant({dropped: (s) => [s, []]}),
	/** A tsh started again begins with an empty table. */
	forgetsTheKept: {...jobsMachine, init: () => [EMPTY, []]},
} satisfies Record<string, Machine>;

describe("the job table's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(jobsMachine);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			// A number given twice muddles every law that finds a job by its number.
			countsForNumbers: [
				numbersOnce.name,
				numbered.name,
				neverReused.name,
				detachedWaits.name,
				backgroundByAsk.name,
				ownerByAsk.name,
				lastEndLeaves.name,
				dropLeaves.name,
			],
			// The rule before `next`: a job that ended frees its number, and the next job takes it.
			lowestFree: [numbered.name, neverReused.name],
			endsDetached: [detachedWaits.name],
			leavesEarly: [leavesRightly.name],
			dropsRunning: [leavesRightly.name],
			keepsEnded: [runningLive.name, lastEndLeaves.name],
			detachForgetsBackground: [backgroundByAsk.name],
			deafToFg: [fgWaits.name],
			attachKeepsEnded: [attachRuns.name],
			attachKeepsOwner: [attachRuns.name],
			detachForgetsOwner: [ownerByAsk.name],
			deafToDrop: [dropLeaves.name],
			forgetsTheKept: [keptComesBack.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});

// ---------------------------------------------------------------- law: every reachable table is kept

/** A stage as tsh writes it: flags are values a program took, so any JSON value, and wired or not. */
const flagged: fc.Arbitrary<StageRecord> = fc.record({
	program: fc.constantFrom("counter", "seq", "say"),
	flags: fc.dictionary(fc.constantFrom("to", "text", "ms", "pr"), fc.jsonValue({maxDepth: 2}), {
		maxKeys: 3,
	}),
	run,
	wire: fc.option(fc.record({output: fc.constantFrom("n", "text"), input: fc.constant("n")}), {
		nil: null,
	}),
	ended: fc.boolean(),
});
const keptTable: MsgArbitraryTable<Msg> = {
	...table,
	began: arbRecordMsg("began", {
		text: fc.constantFrom("counter", "seq --to 3 | say", "counter &"),
		stages: fc
			.tuple(flagged, fc.array(flagged, {maxLength: 2}))
			.map(([first, rest]) => [first, ...rest] as const),
		background: fc.boolean(),
		owner,
	}),
};
const keptLists = fc.array(arbMsg(keptTable, {weights: {began: 3, stage_ended: 4, detached: 1}}), {
	maxLength: 40,
	size: "max",
});

/** Every table `machine` reaches from `loaded`, saved where tsh keeps it, through `Jobs`, and loaded back. */
const keepsEvery = (machine: Machine, loaded: Jobs | null, runs = 150) =>
	fc.assert(
		fc.asyncProperty(keptLists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open(TABLE.run, null));
			const store = handle.store(TABLE.machine, TABLE.key, Jobs);
			for (const jobs of foldEvents(machine, ctx, loaded, list).states) {
				await store.save(jobs);
				expect(store.migrate(await store.load())).toEqual(jobs);
			}
		}),
		{numRuns: runs, seed: 1},
	);

describe("the job table is kept", () => {
	it("every table it reaches, from a fresh start and from a kept one, saves and loads back equal", async () => {
		await keepsEvery(jobsMachine, null);
		await keepsEvery(jobsMachine, KEPT);
	});

	it("the law is seen to fail on a planted mistake: a job that keeps tsh's own handle on it dies at its first save", async () => {
		const withHandle = plant({
			began: (s, m) => {
				const [next] = real.began(s, m);
				return [{...next, jobs: next.jobs.map((job) => ({...job, handle: {pid: 1}}))}, []];
			},
		});
		await expect(keepsEvery(withHandle, null, 20)).rejects.toThrow(/Counterexample/);
	});

	it("a table kept before `next` was opens, and numbers on after every number in it", async () => {
		// The table as older code kept it: its jobs, and no `next`.
		const Older = Schema.Struct({jobs: Schema.Array(Job)});
		const opened = await Effect.runPromise(
			Effect.gen(function* () {
				const storage = memoryStorage();
				const home = yield* storage.open(TABLE.run, null);
				yield* Effect.promise(() =>
					home.store(TABLE.machine, TABLE.key, Older).save({jobs: KEPT.jobs}),
				);
				const host = yield* openJobs(storage);
				yield* host.table.dispatch({
					type: "began",
					text: "counter",
					stages: [{program: "counter", flags: {}, run: "r9", wire: null, ended: false}],
					background: false,
					owner: "t1",
				});
				return {kept: host.kept, table: host.table.getState()};
			}).pipe(Effect.scoped),
		);
		expect(opened.kept).toBe(true);
		// 1 and 3 were in it, so the next job is 4: never 2, which an ended job may have had.
		expect(opened.table.jobs.map((job) => [job.n, job.state])).toEqual([
			[1, "detached"],
			[3, "detached"],
			[4, "running"],
		]);
		expect(opened.table.next).toBe(5);
	});

	it("a table kept before jobs had an owner opens, each job's owner not known", async () => {
		// The table as older code kept it: no job names its tsh.
		const Older = Schema.Struct({jobs: Schema.Array(Schema.Unknown), next: Schema.Int});
		const opened = await Effect.runPromise(
			Effect.gen(function* () {
				const storage = memoryStorage();
				const home = yield* storage.open(TABLE.run, null);
				yield* Effect.promise(() =>
					home
						.store(TABLE.machine, TABLE.key, Older)
						.save({jobs: KEPT.jobs.map(({owner: _, ...older}) => older), next: KEPT.next}),
				);
				const host = yield* openJobs(storage);
				return {kept: host.kept, table: host.table.getState()};
			}).pipe(Effect.scoped),
		);
		expect(opened.kept).toBe(true);
		expect(opened.table.jobs.map((job) => [job.n, job.owner])).toEqual([
			[1, null],
			[3, null],
		]);
	});
});
