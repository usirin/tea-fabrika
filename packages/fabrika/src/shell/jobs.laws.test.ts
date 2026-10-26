import {
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import type {MsgOf} from "../program/program.ts";
import {type Job, type Jobs, jobsMachine, type StageRecord} from "./jobs.ts";

// The laws of tsh's job table, on tea's pbt: after every step of any list of Msgs, from the real
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

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	began: arbRecordMsg("began", {
		text: fc.constantFrom("counter", "seq --to 3 | say", "counter &"),
		stages: fc
			.tuple(stage, fc.array(stage, {maxLength: 2}))
			.map(([first, rest]) => [first, ...rest] as const),
		background: fc.boolean(),
	}),
	stage_ended: arbRecordMsg("stage_ended", {run}),
	detached: arbRecordMsg("detached", {n: fc.option(n, {nil: null})}),
	attached: arbRecordMsg("attached", {n, background: fc.boolean()}),
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

/** A table an earlier tsh kept: one job detached with a program ended, one running in the background. */
const KEPT: Jobs = {
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
		},
		{
			n: 3,
			text: "counter &",
			stages: [{program: "counter", flags: {}, run: "r3", wire: null, ended: false}],
			state: "running",
			background: true,
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

const lowestFree = everyStep(
	"a line that begins is a new job at the end, running, with the lowest number no job has; nothing else changes",
	({prev, msg, next}) => {
		if (msg.type !== "began") return true;
		const taken = new Set(prev.jobs.map((job) => job.n));
		let free = 1;
		while (taken.has(free)) free += 1;
		const made: Job = {
			n: free,
			text: msg.text,
			stages: msg.stages,
			state: "running",
			background: msg.background,
		};
		return JSON.stringify(next.jobs) === JSON.stringify([...prev.jobs, made]);
	},
);

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
	lowestFree,
	detachedWaits,
	leavesRightly,
	runningLive,
	backgroundByAsk,
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
			return [{jobs: [...s.jobs, {...made, n: s.jobs.length + 1}]}, []];
		},
	}),
	/** A program's end is marked on a detached job too. */
	endsDetached: plant({
		stage_ended: (s, m) => {
			const [next] = real.stage_ended(s, m);
			const mark = (job: Job): Job =>
				job.state !== "detached" ? job : {...job, stages: endedIn(job.stages, m.run)};
			return [{jobs: next.jobs.map(mark)}, []];
		},
	}),
	/** A job leaves at the end of its first program. */
	leavesEarly: plant({
		stage_ended: (s, m) => [
			{
				jobs: s.jobs.filter(
					(job) => job.state !== "running" || !job.stages.some((st) => st.run === m.run),
				),
			},
			[],
		],
	}),
	/** drop takes a running job too. */
	dropsRunning: plant({
		dropped: (s, m) => [{jobs: s.jobs.filter((job) => job.n !== m.n)}, []],
	}),
	/** A job whose programs all ended stays in the table. */
	keepsEnded: plant({
		stage_ended: (s, m) => [
			{
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
				jobs: s.jobs.map((job) =>
					job.n === m.n && job.state === "detached"
						? {...job, state: "running" as const, background: m.background}
						: job,
				),
			},
			[],
		],
	}),
	/** drop does nothing. */
	deafToDrop: plant({dropped: (s) => [s, []]}),
	/** A tsh started again begins with an empty table. */
	forgetsTheKept: {...jobsMachine, init: () => [{jobs: []}, []]},
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
				lowestFree.name,
				detachedWaits.name,
				backgroundByAsk.name,
				lastEndLeaves.name,
				dropLeaves.name,
			],
			endsDetached: [detachedWaits.name],
			leavesEarly: [leavesRightly.name],
			dropsRunning: [leavesRightly.name],
			keepsEnded: [runningLive.name, lastEndLeaves.name],
			detachForgetsBackground: [backgroundByAsk.name],
			deafToFg: [fgWaits.name],
			attachKeepsEnded: [attachRuns.name],
			deafToDrop: [dropLeaves.name],
			forgetsTheKept: [keptComesBack.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});
