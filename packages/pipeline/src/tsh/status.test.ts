import {ear, memoryStorage, Shell, start, tell} from "@kampus/fabrika";
import {Deferred, Duration, Effect, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codeHostOn} from "../code-host-github.ts";
import {CodeHost} from "../services.ts";
import {changed, HEADS, RUBRICS, recorded, recordedGh} from "../stages/review/scripted.ts";
import type {PrFacts} from "../stages/ship/facts.ts";
import {defaultConfig} from "./config.ts";
import {fabrikaEntries} from "./fabrika.ts";

// Status lines, as a person meets them: `jobs` mid run, one row under the job
// for each copy of each machine, in the words its program declared. The
// review program on recorded GitHub answers, told three pull requests: the
// first cannot be read (stuck), the second is a draft (skipped), the third's
// checks are still running, until the test lets them settle.

const {describe: describeEntry, JobStorage, Programs, programList, SMALL, tsh} = Shell;
type ProgramList = Shell.ProgramList;
type Printed = Shell.Printed;
type Ready = Shell.Ready;

/** One tsh in this process; `line` tells it a line and answers what it printed. */
const session = (list: ProgramList) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const storage = memoryStorage();
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:status", storage},
		).pipe(Effect.provideService(Programs, list), Effect.provideService(JobStorage, storage));
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				const all = yield* ready.upTo(told);
				return {
					status: all[told - 1]?.status,
					out: printed.values.slice(from).map((p) => p.text),
				};
			});
		/**
		 * `jobs`, again and again, until a row of it has `text`. Only its rows: a job's own output
		 * printed while `jobs` ran is left out.
		 */
		const jobsShowing = (text: string) =>
			Effect.gen(function* () {
				for (;;) {
					const out = (yield* line("jobs")).out.filter(
						(row) => row.startsWith("      ") || /^\[\d+\] (running|detached) /.test(row),
					);
					if (out.some((row) => row.includes(text))) return out;
					yield* Effect.sleep(Duration.millis(5));
				}
			});
		return {started, line, jobsShowing};
	});

const url = (n: number) => `https://github.com/example/repo/pull/${n}`;
/** Clear once a review has kept its rows: each closes the ticket the recorded body names ("Fixes #625"). */
const clear: PrFacts = {
	head: HEADS.final,
	state: "open",
	ours: true,
	ticket: {id: "example/repo#625", link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: {tested: "main0", tip: "main0"},
};

/**
 * GitHub, read from recordings. Pull request 1 cannot be read at all. 2 is a
 * draft. 3's checks run until `settle` is done, and read green after.
 */
const recordedGitHub = () => {
	const settled = Deferred.makeUnsafe<void>();
	let running = true;
	const answer = (pr: string) =>
		changed(recorded("change-final.json"), (repo) => {
			repo.pullRequest.state = "OPEN";
			repo.pullRequest.isDraft = pr === url(2);
			repo.pullRequest.headRefOid = HEADS.final;
			if (pr === url(3) && running)
				for (const check of repo.commit.statusCheckRollup.contexts.nodes)
					Object.assign(check, {status: "IN_PROGRESS", conclusion: null});
		});
	const host = Layer.succeed(CodeHost, {
		pullRequests: () => Effect.succeed([]),
		prFacts: () => Effect.succeed(clear),
		change: (pr, head) => {
			const {gh} = recordedGh("final", {
				now: pr === url(1) ? "breaks" : HEADS.final,
				change: answer(pr),
			});
			return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
		},
		checksSettled: () => Stream.fromEffect(Deferred.await(settled)),
		leftQueue: () => Stream.never,
	});
	return {
		/** The checks of pull request 3 settle, green. */
		settle: Effect.sync(() => {
			running = false;
		}).pipe(Effect.andThen(Deferred.succeed(settled, undefined))),
		list: programList([...SMALL, ...fabrikaEntries(defaultConfig("/tsh"), () => host)]),
	};
};

const REVIEW = `review-scripted --rubrics ${RUBRICS} --model opus --effort medium --budget 1`;

describe("status lines: the user's job", () => {
	it("jobs shows one row per pull request under the review job: the stuck one and the skipped one stay while the third waits, and each row changes as its copy moves", async () => {
		const {list, settle} = recordedGitHub();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {line, jobsShowing, started} = yield* session(list);
				expect((yield* line(`${REVIEW} &`)).status).toBe(0);
				expect((yield* line(`tell %1 pr ${[1, 2, 3].map(url).join(" ")}`)).status).toBe(0);
				const waiting = yield* jobsShowing("#3: waiting on checks");
				yield* settle;
				const settled = yield* jobsShowing("#3: done, passed");
				// A second job, a pipe of two programs: each row says which program it is of. ship in read
				// mode runs no machine, so it has no row.
				expect((yield* line(`${REVIEW} | ship --mode read &`)).status).toBe(0);
				expect((yield* line(`tell %2 pr ${url(4)}`)).status).toBe(0);
				const piped = yield* jobsShowing("#4: done, passed");
				started.close("line");
				yield* started.run.ended;
				return {waiting, settled, piped};
			}).pipe(Effect.scoped),
		);
		// review works its pull requests off its kept queue (experiment 75b): the queue is a row too.
		const job = `[1] running   ${REVIEW}`;
		expect(seen.waiting).toEqual([
			job,
			"      queue   #3 now, nothing else waiting",
			"      review  #1: stuck: read failed",
			"      review  #2: skipped (draft)",
			"      review  #3: waiting on checks",
		]);
		expect(seen.settled).toEqual([
			job,
			"      queue   nothing waiting",
			"      review  #1: stuck: read failed",
			"      review  #2: skipped (draft)",
			"      review  #3: done, passed",
		]);
		expect(seen.piped.slice(5)).toEqual([
			`[2] running   ${REVIEW} | ship --mode read`,
			"      review-scripted queue   nothing waiting",
			"      review-scripted review  #4: done, passed",
		]);
	});
});

describe("status lines: --describe", () => {
	it("names the machines that have a status line, and says nothing of them for a program with no machine", () => {
		const list = programList([...SMALL, ...fabrikaEntries(defaultConfig("/tsh"))]);
		const page = (name: string) => {
			const entry = list.get(name);
			if (entry === undefined) throw new Error(name);
			return describeEntry(entry);
		};
		expect(page("review-scripted")).toContain(
			"status lines: queue, review (one per copy, under the job in jobs)",
		);
		expect(page("tally")).toContain("status lines: count (one per copy, under the job in jobs)");
		expect(page("say").some((l) => l.startsWith("status lines"))).toBe(false);
	});
});
