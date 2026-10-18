import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {defineMachine, type Sub} from "@demlik/tea";
import {Duration, Effect, Fiber, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codeHostOn} from "../code-host-github.ts";
import {listen} from "../primitives.ts";
import {ear} from "../program/ear.ts";
import {defineProgram, kind, start, tell} from "../program/program.ts";
import {input} from "../program/shape.ts";
import {memoryStorage, type Storage} from "../program/storage.ts";
import {fileStorage} from "../program/storage-node.ts";
import {CodeHost} from "../services.ts";
import {changed, HEADS, RUBRICS, recorded, recordedGh} from "../stages/review/scripted.ts";
import type {ShipFacts} from "../stages/ship/facts.ts";
import {fabrikaEntries} from "./fabrika.ts";
import {JobStorage, listed, type ProgramList, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import type {Show} from "./short.ts";
import {SMALL} from "./small.ts";

// tsh, started from code as the launcher starts it: lines told on `line`,
// Ctrl-C on `signal`, and everything it says heard on `printed` and `ready`.
// No terminal here; ./pty.test.ts drives the real one.

const SMALL_LIST = programList(SMALL);

type Waiting = {readonly phase: "waiting" | "over"};
const waiting = defineMachine({
	types: {
		model: {} as Waiting,
		msg: {} as {readonly type: "start"} | {readonly type: "heard"},
		sub: {} as Sub<"checks", {readonly on: true}>,
		ctx: undefined,
	},
	cmds: [],
	init: (loaded) => [loaded ?? {phase: "waiting"}, []],
	update: {start: (s) => [s, []], heard: (): [Waiting, []] => [{phase: "over"}, []]},
	subs: [listen("checks", (s: Waiting) => (s.phase === "waiting" ? {on: true as const} : null))],
});

/** A program whose one machine waits on checks, through a Listen whose stream fails (experiment 73, finding 2). */
const feed = defineProgram({
	name: "feed",
	description: "Waits on checks that never come: their feed breaks.",
	inputs: {},
	outputs: {},
	machines: {
		wait: kind({
			machine: waiting,
			parent: "main",
			options: () => ({
				ctx: undefined,
				subscribe: {checks: () => Stream.fail(new Error("the checks feed broke"))},
				terminal: (s: Waiting) => s.phase === "over",
			}),
			drawing: () => ({name: "wait", steps: {checks: "checks"}}),
			status: (s) => (s.phase === "waiting" ? "waiting on checks" : "over"),
		}),
	},
	main: ({machines}) =>
		machines.wait
			.get("one")
			.start({type: "start"})
			.pipe(
				Effect.flatMap((runtime) => runtime.done()),
				Effect.scoped,
			),
});

/** Reads nothing it is told and ends after a moment: what it was told stays on its line (experiment 80). */
const lazy = defineProgram({
	name: "lazy",
	description: "Takes numbers, reads none of them, and ends after a moment.",
	inputs: {n: input(Schema.Int, "A number it will not read.")},
	outputs: {},
	main: () => Effect.sleep(Duration.millis(200)),
});
let runs = 0;

/** One tsh on a storage. `line` tells it a line and answers what it printed for it, and its status. */
const session = (list: ProgramList, storage: Storage, show: Show = "short") =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		runs += 1;
		const started = yield* start(
			tsh,
			{show},
			{printed: printed.hear, ready: ready.hear},
			{id: `tsh:test-${runs}`, storage},
		).pipe(Effect.provideService(Programs, list), Effect.provideService(JobStorage, storage));
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(tell(started.run, "line", text)).toBe("queued");
				told += 1;
				const all = yield* ready.upTo(told);
				const said = printed.values.slice(from);
				return {
					status: all[told - 1]?.status,
					out: said.filter((p) => p.to === "out").map((p) => p.text),
					err: said.filter((p) => p.to === "err").map((p) => p.text),
				};
			});
		/** Wait until tsh has printed a line that has `text` in it: a job's output comes when it comes. */
		const heard = (text: string) =>
			Effect.gen(function* () {
				while (!printed.values.some((p) => p.text.includes(text)))
					yield* Effect.sleep(Duration.millis(5));
			}).pipe(Effect.timeout(Duration.seconds(5)), Effect.orDie);
		return {started, line, heard, printed, ready};
	});

describe("tsh: the user's job, one session", () => {
	it("runs lines, pipes, $( ), refusals and a job, and says each line's status", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard, started} = yield* session(SMALL_LIST, memoryStorage());
				expect(yield* line("seq --to 5 | double")).toEqual({
					status: 0,
					out: ["double 2", "double 4", "double 6", "double 8", "double 10"],
					err: [],
				});
				expect((yield* line("say --text 'hi there' | upper")).out).toEqual(["upper HI THERE"]);
				expect((yield* line("double n=$(seq --to 3) n=7")).out).toEqual(["2", "4", "6", "14"]);
				const refused = yield* line("seq --to 3 | upper");
				expect(refused.status).toBe(2);
				expect(refused.err).toEqual([
					"tsh: does not fit: seq's outputs (n: integer) fit no input of upper (text: string). Nothing was started",
					"  seq --to 3 | upper",
					"             ^",
				]);
				expect(yield* line("sqe --to 3")).toMatchObject({status: 127});

				// A job: the prompt comes back, and it says its totals as it is told numbers.
				const job = yield* line("tally &");
				expect(job.err[0]).toMatch(/^\[1\] tally:[0-9a-f]{8}$/);
				for (const n of [2, 3, 4]) expect((yield* line(`tell %1 add ${n}`)).status).toBe(0);
				yield* heard("[1] 9");
				// Under the job, its one copy's status line.
				expect((yield* line("jobs")).out).toEqual(["[1] running   tally", "      total 9"]);
				expect((yield* line("ps")).out[1]).toMatch(/^tally:[0-9a-f]{8} +tally +%1 +running$/);
				yield* line("close %1 add");
				yield* heard("[1] ended  tally");
				expect((yield* line("jobs")).out).toEqual([]);
				// A number freed is given again.
				expect((yield* line("tally &")).err[0]).toMatch(/^\[1\] /);
				started.close("line");
				yield* started.run.ended;
			}).pipe(Effect.scoped),
		);
	});

	it("chains on the status with && and ||, and says a failure in words", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line} = yield* session(SMALL_LIST, memoryStorage());
				expect(yield* line("false && say --text no")).toEqual({
					status: 1,
					out: [],
					err: ["tsh: false failed: false always fails"],
				});
				expect((yield* line("false || say --text yes")).out).toEqual(["yes"]);
				expect((yield* line("true && say --text and; false")).status).toBe(1);
			}).pipe(Effect.scoped),
		);
	});

	it("a job whose machine's Listen fails ends, and says why: it does not freeze on its last line", async () => {
		const list = programList([...SMALL, listed(feed, Layer.empty)]);
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard} = yield* session(list, memoryStorage());
				expect((yield* line("feed &")).err[0]).toMatch(/^\[1\] feed:/);
				yield* heard("[1] ended 1  feed");
				yield* heard(`[1] feed failed: wait run one failed (tea's "sub"): the checks feed broke`);
				expect((yield* line("jobs")).out).toEqual([]);
			}).pipe(Effect.scoped),
		);
	});

	it("a stage that ends with values it never read says how many, in the foreground and as a job: never that it finished all it held", async () => {
		const list = programList([...SMALL, listed(lazy, Layer.empty)]);
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard} = yield* session(list, memoryStorage());
				const fore = yield* line("seq --to 5 | lazy");
				expect(fore.status).toBe(0);
				expect(fore.err).toEqual(["tsh: lazy ended with 5 told on n never read"]);
				yield* line("seq --to 3 | lazy &");
				yield* heard("[1] lazy ended:");
				yield* heard("[1] lazy ended: it stopped reading, with 3 told on n never read");
			}).pipe(Effect.scoped),
		);
	});

	it("ends on exit, with that status", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, started} = yield* session(SMALL_LIST, memoryStorage());
				expect((yield* line("exit 7")).status).toBe(7);
				expect((yield* started.run.ended).kind).toBe("ended");
			}).pipe(Effect.scoped),
		);
	});
});

describe("tsh: Ctrl-C", () => {
	it("stops what runs in the foreground with its starter's stop, and tsh goes on", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, started} = yield* session(SMALL_LIST, memoryStorage());
				const waiting = yield* Effect.forkScoped(line("sleep --ms 60000"));
				yield* Effect.sleep(Duration.millis(50));
				tell(started.run, "signal", "interrupt");
				expect(yield* Fiber.join(waiting)).toMatchObject({
					status: 130,
					err: ["[stopped] sleep --ms 60000"],
				});
				expect((yield* line("say --text after")).out).toEqual(["after"]);

				// A job brought here with attach is stopped the same way, and leaves the table.
				yield* line("sleep --ms 60000 &");
				const attached = yield* Effect.forkScoped(line("attach %1"));
				yield* Effect.sleep(Duration.millis(50));
				tell(started.run, "signal", "interrupt");
				expect((yield* Fiber.join(attached)).status).toBe(130);
				expect((yield* line("jobs")).out).toEqual([]);
				// With nothing in the foreground, Ctrl-C does nothing.
				tell(started.run, "signal", "interrupt");
				expect((yield* line("say --text still")).out).toEqual(["still"]);
			}).pipe(Effect.scoped),
		);
	});
});

describe("tsh: kept jobs", () => {
	it("a job outlives a killed tsh: the next one finds it, and starts it again by run id with its total", async () => {
		const storage = fileStorage(mkdtempSync(join(tmpdir(), "tsh-storage-")));
		const run = await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard, started} = yield* session(SMALL_LIST, storage);
				const id = (yield* line("tally &")).err[0]?.split(" ")[1] ?? "";
				yield* line("tell %1 add 2");
				yield* line("tell %1 add 3");
				yield* heard("[1] 5");
				// Killed: stopped from outside, with no word to its jobs.
				yield* started.stop;
				return id;
			}).pipe(Effect.scoped),
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard, printed} = yield* session(SMALL_LIST, storage);
				yield* line("");
				expect(printed.values[0]?.text).toContain("1 job from an earlier tsh, not running: %1");
				expect((yield* line("jobs")).out).toEqual(["[1] detached  tally"]);
				expect((yield* line("tell %1 add 1")).err[0]).toContain("%1 is detached");
				expect((yield* line(`attach ${run} &`)).err).toEqual([`[1] attached ${run}`]);
				yield* line("tell %1 add 1");
				yield* heard("[1] 6");
			}).pipe(Effect.scoped),
		);
	});

	it("a tsh left with Ctrl-D does not leave the next one born with its line closed", async () => {
		const storage = fileStorage(mkdtempSync(join(tmpdir(), "tsh-storage-")));
		for (const _ of [1, 2, 3])
			await Effect.runPromise(
				Effect.gen(function* () {
					const {line, started} = yield* session(SMALL_LIST, storage);
					expect((yield* line("say --text again")).out).toEqual(["again"]);
					started.close("line");
					expect((yield* started.run.ended).kind).toBe("ended");
				}).pipe(Effect.scoped),
			);
	});

	it("stop drops a detached job for good", async () => {
		const storage = memoryStorage();
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, started} = yield* session(SMALL_LIST, storage);
				yield* line("tally &");
				yield* started.stop;
			}).pipe(Effect.scoped),
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line} = yield* session(SMALL_LIST, storage);
				yield* line("");
				expect((yield* line("stop %1")).err).toEqual(["[1] dropped  tally"]);
				expect((yield* line("jobs")).out).toEqual([]);
			}).pipe(Effect.scoped),
		);
	});
});

// ---------------------------------------------------------------- fabrika's own programs

const url = (n: number) => `https://github.com/example/repo/pull/${n}`;
const clear: ShipFacts = {
	head: HEADS.final,
	state: "open",
	ours: true,
	ticket: "closes_it",
	approval: "not_needed",
	reviews: "passed",
	reviewKinds: [],
	checks: "green",
	mergeable: "clean",
	comments: [],
};
/** The recorded pull request, open at the head that merged. */
const opened = changed(recorded("change-final.json"), (repo) => {
	repo.pullRequest.state = "OPEN";
	repo.pullRequest.headRefOid = HEADS.final;
});

/** GitHub, read from recordings: every pull request is the recorded one, open and clear. */
function recordedGitHub() {
	const reads: string[] = [];
	const host = Layer.succeed(CodeHost, {
		prFacts: (pr) =>
			Effect.sync(() => {
				reads.push(pr);
				return clear;
			}),
		change: (pr, head) => {
			const {gh} = recordedGh("final", {now: HEADS.final, change: opened});
			return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
		},
		checksSettled: () => Stream.make(undefined),
		leftQueue: () => Stream.never,
	});
	return {
		reads,
		list: programList([...SMALL, ...fabrikaEntries({own: [], reviewers: []}, () => host)]),
	};
}

describe("tsh: review | ship", () => {
	it("reviews pull requests and pipes each that passed into a read-only ship, on one line", async () => {
		const {list, reads} = recordedGitHub();
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line} = yield* session(list, memoryStorage(), "json");
				const prs = [1, 2, 3].map((n) => `pr=${url(n)}`).join(" ");
				const text = `review-scripted --rubrics ${RUBRICS} --model opus --effort medium --budget 1 ${prs} | ship --mode read`;
				const done = yield* line(text);
				expect(done.status).toBe(0);
				const verdicts = done.out.filter((l) => l.startsWith("review-scripted verdict "));
				const found = done.out
					.filter((l) => l.startsWith("ship found "))
					.map((l) => JSON.parse(l.slice(11)));
				expect(verdicts).toHaveLength(3);
				// Read mode: the machine stops where it would write, and says what it would send.
				expect(found.map((f) => [f.pr, f.facts?.ours, f.wouldSend?.type])).toEqual(
					[1, 2, 3].map((n) => [url(n), true, "ship_enqueue"]),
				);
				expect(reads).toEqual([url(1), url(2), url(3)]);

				// The same line for a person: one short line per value, the JSON one --json away.
				const person = yield* session(list, memoryStorage(), "short");
				const short = yield* person.line(text);
				expect(short.status).toBe(0);
				expect(short.out.filter((l) => l.startsWith("ship found "))).toEqual(
					[1, 2, 3].map(
						(n) =>
							`ship found #${n}  facts (open, closes_it, not_needed, passed, green, clean)  wouldSend ship_enqueue`,
					),
				);
				expect(short.out.every((l) => l.length <= 120)).toBe(true);
			}).pipe(Effect.scoped),
		);
	});

	it("refuses ship's write mode before anything is read", async () => {
		const {list, reads} = recordedGitHub();
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line} = yield* session(list, memoryStorage());
				const done = yield* line(`ship --mode write pr=${url(1)}`);
				expect(done.status).toBe(2);
				expect(done.err[0]).toBe('tsh: --mode does not take "write": Expected "read"');
				expect(reads).toEqual([]);
			}).pipe(Effect.scoped),
		);
	});

	it("a hole: any text fits a pull request url by its JSON Schema, so say | ship is wired, and breaks when it runs", async () => {
		const {list, reads} = recordedGitHub();
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line} = yield* session(list, memoryStorage());
				const done = yield* line("say --text hello | ship --mode read");
				expect(done.status).toBe(1);
				expect(done.err).toEqual([
					"tsh: say failed: say sent said down a pipe that answered bad_shape",
				]);
				expect(reads).toEqual([]);
			}).pipe(Effect.scoped),
		);
	});
});
