import {Effect, Layer, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {HostJobs, type JobTable, openJobs} from "../host/host-jobs.ts";
import type {Job} from "../host/jobs.ts";
import {ear} from "../program/ear.ts";
import {listed} from "../program/listed.ts";
import {defineProgram, start, tell} from "../program/program.ts";
import {input, output} from "../program/shape.ts";
import {memoryStorage} from "../program/storage.ts";
import {forAgent, type ProgramList, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";

// One writer per job, and the agent's list (tracker 185b, PR 2). Today's version.
//
// A job keeps one writer for life (d9). `attach %n` refuses a job whose `by` is known and is not
// this tsh's writer, both ways: a person's lane never goes on as an agent, an agent's never as the
// person. A job with `by: null`, kept before jobs had one, attaches anywhere, as before.
//
//   t1's tsh, as user:github:7      tsh$ attach %1 &       (job 1 is agent:claude for:github:7's)
//                                   tsh: this job is agent:claude for:github:7's: attach it in claude's tile
//
// An agent's tsh drops no one else's job (d10). `stop %n` of a detached job drops it, whoever's it
// is, in a person's tsh. In a tsh whose writer is an agent, another writer's job is refused: the
// `stop` tool, with its `why`, is the only way an agent stops a person's job.
//
//   claude's tsh                    tsh$ stop %1           (job 1 is user:github:7's)
//                                   tsh: %1 is user:github:7's: the stop tool asks why
//
// And a tsh handed `forAgent(list)` (d8, the path through tsh) reaches no input only a person
// tells: not on the line, not by `tell`, not by a pipe. Its other inputs are told as before.

const PERSON = "user:github:7";
const AGENT = "agent:claude for:github:7";
const OTHER_PERSON = "user:github:8";
const OTHER_AGENT = "agent:review for:github:7";
const WRITERS = [PERSON, AGENT, OTHER_PERSON, OTHER_AGENT] as const;
const LONG = "sleep --ms 60000";
const LIST = programList(SMALL);

/** A tsh in tile t1, writing as `by`, on a table of its own, starting programs from `list`. */
const tshAs = (by: string, list: ProgramList = LIST) =>
	Effect.gen(function* () {
		const storage = memoryStorage();
		const jobs = yield* openJobs(storage);
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:agent", storage},
		).pipe(
			Effect.provideService(HostJobs, {...jobs, owner: "t1", by}),
			Effect.provideService(Programs, list),
		);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		/** One line, its `ready`, and what it printed on err. */
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				const all = yield* ready.upTo(told);
				const err = printed.values
					.slice(from)
					.filter((p) => p.to === "err")
					.map((p) => p.text);
				return {status: all[told - 1]?.status, err};
			});
		return {table: jobs.table, run: started.run, printed, line};
	});

/** A job begun by another tile's tsh, as `by`, then detached: what an earlier host left. */
const detachedJob = (table: JobTable, by: string | null) =>
	Effect.gen(function* () {
		yield* table.dispatch({
			type: "began",
			text: LONG,
			stages: [{program: "sleep", flags: {ms: 60000}, run: "sleep:kept", wire: null, ended: false}],
			background: true,
			owner: "t2",
			by,
		});
		const n = table.getState().next - 1;
		yield* table.dispatch({type: "detached", n});
		return n;
	});

const jobIn = (table: JobTable, n: number): Job | undefined =>
	table.getState().jobs.find((job) => job.n === n);

/** Wait for `check` to answer something, three seconds at most. */
const until = <T>(what: string, check: () => T | undefined) =>
	Effect.gen(function* () {
		for (let i = 0; i < 300; i += 1) {
			const got = check();
			if (got !== undefined) return got;
			yield* Effect.sleep("10 millis");
		}
		return yield* Effect.die(`waited for ${what}`);
	});

describe("attach keeps a job's one writer (d9)", () => {
	it("refuses a person's tsh an agent's job, and names the agent's tile", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshAs(PERSON);
				const n = yield* detachedJob(t.table, AGENT);
				const before = jobIn(t.table, n);
				const said = yield* t.line(`attach %${n} &`);
				return {said, before, after: jobIn(t.table, n)};
			}).pipe(Effect.scoped),
		);
		expect(seen.said.status).not.toBe(0);
		expect(seen.said.err).toContain(`tsh: this job is ${AGENT}'s: attach it in claude's tile`);
		// Not started again: still detached, still the earlier tile's, still the agent's.
		expect(seen.after).toEqual(seen.before);
		expect(seen.after?.state).toBe("detached");
	});

	it("refuses an agent's tsh a person's job", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshAs(AGENT);
				const n = yield* detachedJob(t.table, PERSON);
				const before = jobIn(t.table, n);
				const said = yield* t.line(`attach %${n} &`);
				return {said, before, after: jobIn(t.table, n)};
			}).pipe(Effect.scoped),
		);
		expect(seen.said.status).not.toBe(0);
		expect(seen.said.err.some((text) => text.includes(`this job is ${PERSON}'s`))).toBe(true);
		expect(seen.after).toEqual(seen.before);
	});

	it("attaches a job with no writer known in any tsh, as before, and keeps its by", async () => {
		for (const by of [PERSON, AGENT]) {
			const seen = await Effect.runPromise(
				Effect.gen(function* () {
					const t = yield* tshAs(by);
					const n = yield* detachedJob(t.table, null);
					const said = yield* t.line(`attach %${n} &`);
					return {said, after: jobIn(t.table, n)};
				}).pipe(Effect.scoped),
			);
			expect(seen.said.status).toBe(0);
			expect(seen.after).toMatchObject({state: "running", owner: "t1", by: null});
		}
	});

	it("attaches only a job whose writer is this tsh's, or not known, for any two writers", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom(...WRITERS),
				fc.constantFrom<string | null>(...WRITERS, null),
				(mine, theirs) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const t = yield* tshAs(mine);
							const n = yield* detachedJob(t.table, theirs);
							const said = yield* t.line(`attach %${n} &`);
							const after = jobIn(t.table, n);
							const may = theirs === null || theirs === mine;
							expect({
								attached: said.status === 0,
								state: after?.state,
								by: after?.by,
								named: said.err.some((text) => text.includes(`this job is ${theirs}'s`)),
							}).toEqual({
								attached: may,
								state: may ? "running" : "detached",
								// Whoever attached it, or not, the job keeps the writer it began with.
								by: theirs,
								named: !may,
							});
						}).pipe(Effect.scoped),
					),
			),
			{numRuns: 20, seed: 119120},
		);
	}, 60_000);
});

describe("an agent's tsh drops no one else's job (d10)", () => {
	it("refuses an agent's stop %n of a person's detached job, and asks no stop of it", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshAs(AGENT);
				const n = yield* detachedJob(t.table, PERSON);
				const before = jobIn(t.table, n);
				const said = yield* t.line(`stop %${n}`);
				return {n, said, before, after: jobIn(t.table, n)};
			}).pipe(Effect.scoped),
		);
		expect(seen.said.status).not.toBe(0);
		expect(seen.said.err).toContain(`tsh: %${seen.n} is ${PERSON}'s: the stop tool asks why`);
		// Still in the table, detached, with no stop asked: the record keeps no stopper.
		expect(seen.after).toEqual(seen.before);
		expect(seen.after?.stop).toBeNull();
	});

	it("drops an agent's job in a person's tsh: a person may stop any job", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshAs(PERSON);
				const n = yield* detachedJob(t.table, AGENT);
				const said = yield* t.line(`stop %${n}`);
				return {n, said, after: jobIn(t.table, n)};
			}).pipe(Effect.scoped),
		);
		expect(seen.said.status).toBe(0);
		expect(seen.said.err).toContain(`[${seen.n}] dropped  ${LONG}`);
		expect(seen.after).toBeUndefined();
	});

	it("drops an agent's own detached job in its tsh", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshAs(AGENT);
				const n = yield* detachedJob(t.table, AGENT);
				const said = yield* t.line(`stop %${n}`);
				return {said, after: jobIn(t.table, n)};
			}).pipe(Effect.scoped),
		);
		expect(seen.said.status).toBe(0);
		expect(seen.after).toBeUndefined();
	});

	it("drops a detached job unless the tsh is an agent's and the job another writer's, for any two writers", async () => {
		await fc.assert(
			fc.asyncProperty(fc.constantFrom(...WRITERS), fc.constantFrom(...WRITERS), (mine, theirs) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const t = yield* tshAs(mine);
						const n = yield* detachedJob(t.table, theirs);
						const said = yield* t.line(`stop %${n}`);
						const after = jobIn(t.table, n);
						const refused = mine.startsWith("agent:") && theirs !== mine;
						expect({
							dropped: said.status === 0,
							left: after === undefined ? null : {state: after.state, stop: after.stop},
							why: said.err.includes(`tsh: %${n} is ${theirs}'s: the stop tool asks why`),
						}).toEqual({
							dropped: !refused,
							// Refused: still in the table, detached, with no stop asked of it.
							left: refused ? {state: "detached", stop: null} : null,
							why: refused,
						});
					}).pipe(Effect.scoped),
				),
			),
			{numRuns: 20, seed: 119120},
		);
	}, 60_000);
});

// A program with one input only a person tells, and one anyone may: what the tracker's `answer`
// and `query` are, small.
const asker = defineProgram({
	name: "asker",
	description: "Says each value it is told, and on which input. Its answer is a person's only.",
	inputs: {
		answer: input(Schema.Int, "An answer. A person only.", {personOnly: true}),
		add: input(Schema.Int, "A number."),
	},
	outputs: {said: output(Schema.String, "Which input, and the value.")},
	main: ({serve, send}) =>
		serve({
			answer: (n) => send("said", `answer ${n}`),
			add: (n) => send("said", `add ${n}`),
		}),
});

const ASKING = programList([listed(asker, Layer.empty), ...SMALL]);

/**
 * What asker said, on out. A job's values print with its number first, `[1] add 2`, and in a
 * pipe with the program's name too, `[1] asker add 2`.
 */
const saidBy = (printed: readonly Printed[]) =>
	printed.filter((p) => p.to === "out").map((p) => p.text.replace(/^\[\d+\] (asker )?/, ""));

describe("a tsh on forAgent's list reaches no input only a person tells (d8)", () => {
	it("refuses the input on the line, and starts nothing", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshAs(AGENT, forAgent(ASKING));
				const said = yield* t.line("asker answer=1");
				return {said, jobs: t.table.getState().jobs.length, printed: t.printed.values};
			}).pipe(Effect.scoped),
		);
		expect(seen.said.status).not.toBe(0);
		expect(seen.said.err.some((text) => text.includes("asker has no input named answer"))).toBe(
			true,
		);
		expect(seen.jobs).toBe(0);
		expect(saidBy(seen.printed)).toEqual([]);
	});

	it("refuses tell %n answer, and tells add as before", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshAs(AGENT, forAgent(ASKING));
				const began = yield* t.line("asker &");
				const answered = yield* t.line("tell %1 answer 1");
				const added = yield* t.line("tell %1 add 2");
				yield* until("asker's add", () =>
					saidBy(t.printed.values).includes("add 2") ? true : undefined,
				);
				return {began, answered, added, said: saidBy(t.printed.values)};
			}).pipe(Effect.scoped),
		);
		expect(seen.began.status).toBe(0);
		expect(seen.answered.status).not.toBe(0);
		expect(seen.answered.err.some((text) => text.includes("asker has no input named answer"))).toBe(
			true,
		);
		expect(seen.added.status).toBe(0);
		expect(seen.said).toEqual(["add 2"]);
	});

	it("refuses a pipe into answer, and a pipe with no input named feeds add", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshAs(AGENT, forAgent(ASKING));
				const named = yield* t.line("seq --to 1 | asker <answer &");
				const fed = yield* t.line("seq --to 2 | asker &");
				yield* until("asker's adds", () =>
					saidBy(t.printed.values).includes("add 2") ? true : undefined,
				);
				return {named, fed, said: saidBy(t.printed.values)};
			}).pipe(Effect.scoped),
		);
		expect(seen.named.status).not.toBe(0);
		expect(seen.fed.status).toBe(0);
		expect(seen.said).toEqual(["add 1", "add 2"]);
	});
});
