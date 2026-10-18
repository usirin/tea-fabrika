import {
	defineProgram,
	pipe,
	type RunningOf,
	type RunOf,
	start,
	tell,
} from "@tea-fabrika/tea-program";
import {ear} from "@tea-fabrika/tea-program/ear";
import {mortalDisk} from "@tea-fabrika/tea-program/mortal";
import {input, output} from "@tea-fabrika/tea-program/shape";
import {memoryStorage, type Storage} from "@tea-fabrika/tea-program/storage";
import {Deferred, Effect, Fiber, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codeHostOn} from "../../code-host-github.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import {buildProgram} from "../build/program.ts";
import {built, builtBy, scriptedBuilder} from "../build/scripted.ts";
import {BuildHost, BuildWrites} from "../build/services.ts";
import {READY, type Ticket, TicketUrl} from "../build/ticket.ts";
import type {Brief} from "../review/gate.ts";
import type {Drafted} from "../review/reviewer.ts";
import {
	changed,
	HEADS,
	RUBRICS,
	recorded,
	recordedGh,
	scriptedReviewer,
} from "../review/scripted.ts";
import type {Form} from "../review/sheet.ts";
import type {ShipFacts} from "../ship/facts.ts";
import {type Ended, operateProgram, type Step} from "./program.ts";
import {ReviewWrites, type Verdict} from "./writes.ts";

// The operate program, started from code the way tsh starts it: the loop, the
// build, review and ship machines and their handlers are the real ones. What
// stands in: the builder and the reviewer (scripted), and the world they
// write to (fakes that keep every write). The review reads a real recorded
// pull request through the real GitHub reader.

/** The repository the recorded answers were read from. Any repository's ticket is taken. */
const REPO = "https://github.com/kamp-us/tea-fabrika-sandbox";
const TICKET = `${REPO}/issues/1`;
const PR = `${REPO}/pull/9`;
const FLAGS = {
	rubrics: RUBRICS,
	model: "opus",
	effort: "medium",
	budget: 1,
	rounds: 3,
	ship: "write",
} as const;

const ticket: Ticket = {
	url: TICKET,
	number: 1,
	state: "open",
	title: "stop() hangs when the store's save never ends",
	body: "- [ ] it ends",
	labels: [READY],
	criteria: [{n: 1, text: "it ends", checked: false, evidence: null}],
	prs: [],
};

/** A pull request ship would land. */
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

const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		n: criterion.n,
		grade: "pass" as const,
		where: [{file: "packages/code-graph/src/api/cli.ts", first: 1, last: 2}],
		says: "It does.",
		limit: null,
	})),
	findings: [],
	skipped: [],
});
/** Criterion 4 fails, with one finding that says what would close it. */
const failing = (brief: Brief): Form => ({
	...passing(brief),
	rows: passing(brief).rows.map((row) =>
		row.n === 4
			? {n: 4, grade: "fail" as const, where: [], says: "The reference page does not name it."}
			: row,
	),
	findings: [
		{
			kind: "review-doc",
			from: {source: "criterion", n: 4},
			fault: "The CLI reference does not name exit 3.",
			at: null,
			proof: "Grep finds no `3` in the exits table.",
			wants: "The page names exit 3.",
		},
	],
});
const RAN = {
	spend: {costUsd: 0.25, tokens: 1000, context: 1000, turns: 2, minutes: 0.1},
	tools: [],
	refused: [],
	links: 0,
};
const drafts =
	(form: (brief: Brief) => Form) =>
	(brief: Brief): Drafted => ({answer: "form", form: form(brief), ...RAN});

/** The recorded pull request, open, with its merged head as its head now. */
const opened = changed(recorded("change-final.json"), (repo) => {
	repo.pullRequest.state = "OPEN";
	repo.pullRequest.headRefOid = HEADS.final;
});

/**
 * The world one start writes to, as fakes that keep each write in order.
 * `reviews`: what the reviewer answers, one per review, the last again after.
 * `hold`: a review that never ends, by its number from 1.
 */
function world(reviews: readonly ((brief: Brief) => Form)[], more: {readonly hold?: number} = {}) {
	const writes: string[] = [];
	const posted: Verdict[] = [];
	let pushes = 0;
	let reviewed = 0;
	const held = Deferred.makeUnsafe<void>();
	const host = Layer.succeed(CodeHost, {
		prFacts: () => Effect.succeed(clear),
		change: (pr, head) => {
			const {gh} = recordedGh("final", {now: HEADS.final, change: opened});
			return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
		},
		checksSettled: () => Stream.make(undefined),
		leftQueue: () => Stream.make({reading: "landed" as const, commit: "c".repeat(40)}),
	});
	const shipWrites = Layer.succeed(CodeHostWrites, {
		enqueue: (pr, head) => {
			writes.push(`enqueue ${pr} ${head}`);
			return Effect.succeed("queued" as const);
		},
		merge: () => Effect.die("this repository has a merge queue"),
		rerunChecks: () => Effect.die("no checks are red here"),
	});
	const buildHost = Layer.succeed(BuildHost, {ticket: () => Effect.succeed(ticket)});
	const buildWrites = Layer.succeed(BuildWrites, {
		copy: (_, number) =>
			Effect.succeed({
				tree: `/work/trees/${number}`,
				branch: `build/${number}`,
				base: "b".repeat(40),
			}),
		push: () =>
			Effect.sync(() => {
				pushes += 1;
				writes.push(`push ${pushes}`);
				return {head: String(pushes).repeat(40), changed: true};
			}),
		open: () =>
			Effect.sync(() => {
				writes.push(`open ${PR}`);
				return PR;
			}),
	});
	const reviewWrites = Layer.succeed(ReviewWrites, {
		post: (v) =>
			Effect.sync(() => {
				posted.push(v);
				writes.push(`post ${v.kind} ${v.verdict}`);
			}),
	});
	const builder = scriptedBuilder((brief) => built(builtBy(`round ${brief.round}`)));
	const reviewer = scriptedReviewer(
		(brief) => {
			const form = reviews[Math.min(reviewed, reviews.length) - 1] ?? passing;
			return drafts(form)(brief);
		},
		{
			hold: Effect.suspend(() => {
				reviewed += 1;
				return reviewed === more.hold
					? Deferred.succeed(held, undefined).pipe(Effect.andThen(Effect.never))
					: Effect.void;
			}),
		},
	);
	const services = Layer.mergeAll(
		host,
		shipWrites,
		buildHost,
		buildWrites,
		reviewWrites,
		builder.layer,
		reviewer.layer,
	);
	return {services, writes, posted, briefs: builder.briefs, held: Deferred.await(held)};
}

type OperateRun = RunOf<typeof operateProgram>;
type Heard = {
	readonly steps: ReturnType<typeof ear<Step>>;
	readonly ended: ReturnType<typeof ear<Ended>>;
};

/** One start of the run on `storage` under one id: `body` runs, then the scope closes, as a crash would close it. */
const once = <A>(
	w: ReturnType<typeof world>,
	storage: Storage,
	body: (run: OperateRun, heard: Heard, close: (name: "ticket") => void) => Effect.Effect<A>,
	flags:
		| typeof FLAGS
		| {readonly [K in keyof typeof FLAGS]: (typeof FLAGS)[K] | number | string} = FLAGS,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const steps = ear<Step>();
			const ended = ear<Ended>();
			const started = yield* start(
				operateProgram,
				flags as typeof FLAGS,
				{step: steps.hear, ended: ended.hear},
				{id: "operate:test", storage},
			);
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			return yield* body(started.run, {steps, ended}, started.close);
		}).pipe(Effect.scoped, Effect.provide(w.services), Effect.timeout("5 seconds")),
	);

/** Tell it the ticket, close its input, and hear how the loop ended. */
const toTheEnd = (run: OperateRun, heard: Heard, close: (name: "ticket") => void) =>
	Effect.gen(function* () {
		expect(tell(run, "ticket", TICKET)).toBe("queued");
		close("ticket");
		const [end] = yield* heard.ended.upTo(1);
		return end as Ended;
	});

describe("operate: the user's job", () => {
	it("one ticket: round 1 leaves a criterion open, round 2 is told it and closes it, the verdicts are posted, and ship lands it; three runs, one answer", async () => {
		const run = async () => {
			const w = world([failing, passing]);
			const end = await once(w, memoryStorage(), toTheEnd);
			return {end, w};
		};
		const {end, w} = await run();
		expect(end.name).toBe("done");
		expect(end.outcome).toMatchObject({kind: "done", pr: PR, head: "c".repeat(40), rounds: 2});
		expect(end.rounds.map((r) => [r.n, r.built, r.reviewed, r.open])).toEqual([
			[1, "done", "send:builder:review_failed", 1],
			[2, "done", "done", 0],
		]);
		// Round 2's builder was told what round 1's review left open, in its words.
		expect(w.briefs.map((b) => b.round)).toEqual([1, 2]);
		expect(w.briefs[0]?.open).toEqual([]);
		expect(w.briefs[1]?.open).toMatchObject([{n: 4, wants: ["The page names exit 3."]}]);
		// One pull request, brought up to date each round; a FAIL then a PASS posted; one enqueue.
		expect(w.writes.filter((x) => x.startsWith("open"))).toEqual([`open ${PR}`, `open ${PR}`]);
		expect(w.posted.map((p) => p.verdict)).toContain("fail");
		expect(w.posted.at(-1)?.verdict).toBe("pass");
		expect(w.writes.filter((x) => x.startsWith("enqueue"))).toEqual([
			`enqueue ${PR} ${HEADS.final}`,
		]);
		const again = [await run(), await run()].map((r) => r.end);
		expect(again).toEqual([end, end]);
	});

	it("the stop rule: a round that leaves the open list no smaller stops the loop, says so, and ships nothing", async () => {
		const w = world([failing]);
		const end = await once(w, memoryStorage(), toTheEnd);
		expect(end.outcome).toEqual({kind: "ask", who: "owner", for: "no_progress"});
		expect(end.said).toBe("send:builder:review_failed");
		expect(end.rounds.map((r) => r.open)).toEqual([1, 1]);
		expect(w.writes.filter((x) => x.startsWith("enqueue"))).toEqual([]);
	});

	it("the cap: with one round allowed, a review that leaves something open ends the loop at the cap", async () => {
		const w = world([failing]);
		const end = await once(w, memoryStorage(), toTheEnd, {...FLAGS, rounds: 1});
		expect(end.outcome).toEqual({kind: "ask", who: "owner", for: "rounds"});
		expect(end.rounds).toHaveLength(1);
		expect(w.briefs).toHaveLength(1);
	});

	it("each stage of each round is said on step, in order", async () => {
		const w = world([failing, passing]);
		const steps = await once(w, memoryStorage(), (run, heard, close) =>
			toTheEnd(run, heard, close).pipe(Effect.as(heard.steps.values)),
		);
		expect(steps.map((s) => `${s.round} ${s.stage} ${s.name}`)).toEqual([
			"1 build done",
			"1 review send:builder:review_failed",
			"2 build done",
			"2 review done",
			"2 ship done",
		]);
		// Each step says why in the stage's words: the open criterion after a failed review, nothing once all pass.
		const said = (round: number, stage: string) =>
			steps.find((s) => s.round === round && s.stage === stage)?.says;
		expect(said(1, "review")).toEqual([expect.stringMatching(/^4\. .+: .+/)]);
		expect(said(2, "review")).toEqual([]);
		expect(said(2, "ship")).toEqual([]);
		expect(said(1, "build")?.length).toBeGreaterThan(0);
	});

	it("status lines: the loop's line walks each stage of each round to its end, and every copy of build, review and ship keeps its row", async () => {
		const w = world([failing, passing]);
		const seen = await once(w, memoryStorage(), (run, heard, close) =>
			Effect.gen(function* () {
				const lines: string[] = [];
				const listening = yield* run.machines.loop.lines.pipe(
					Stream.runForEach((copies) =>
						Effect.sync(() => {
							for (const c of copies) if (lines.at(-1) !== c.line) lines.push(c.line);
						}),
					),
					Effect.forkChild,
				);
				yield* toTheEnd(run, heard, close);
				yield* run.ended;
				yield* Fiber.join(listening);
				const rows = (name: "build" | "review" | "ship" | "queue") =>
					run.machines[name].copies().map((c) => `${c.line}${c.live ? "" : " (ended)"}`);
				return {
					loop: lines,
					build: rows("build"),
					review: rows("review"),
					ship: rows("ship"),
					queue: rows("queue"),
				};
			}),
		);
		expect(seen.loop.filter((l) => l !== "not started")).toEqual([
			"#1 round 1: building",
			"#1 round 1: reviewing PR #9",
			"#1 round 1: posting the review on PR #9",
			"#1 round 2: building",
			"#1 round 2: reviewing PR #9",
			"#1 round 2: posting the review on PR #9",
			"#1: shipping PR #9",
			"#1: done after 2 rounds",
		]);
		expect(seen).toMatchObject({
			build: ["#1 round 1: done, PR #9 (ended)", "#1 round 2: done, PR #9 (ended)"],
			review: ["#9: sent to builder: review failed (ended)", "#9: done, passed (ended)"],
			ship: ["#9: merged (ended)"],
			queue: ["nothing waiting (ended)"],
		});
	});
});

describe("operate: a ticket of any repository", () => {
	it("a url that is not a ticket is refused when it is decoded: bad_shape, and nothing is read or written", async () => {
		const w = world([passing]);
		const words = await once(w, memoryStorage(), (run) =>
			Effect.succeed([
				tell(run, "ticket", "https://github.com/acme/widgets/pull/691"),
				tell(run, "ticket", "https://github.com/acme/widgets/issues/1?x"),
			]),
		);
		expect(words).toEqual(["bad_shape", "bad_shape"]);
		expect(w.writes).toEqual([]);
		expect(w.briefs).toEqual([]);
	});

	it("operate and build take any repository's ticket, and say why when a url is not one", () => {
		for (const shape of [operateProgram.inputs.ticket.shape, buildProgram.inputs.ticket.shape]) {
			expect(shape.check("https://github.com/acme/widgets/issues/670")).toBe(true);
			expect(shape.check(TICKET)).toBe(true);
			expect(shape.problem("https://github.com/acme/widgets/pull/670")).toContain(
				"not a ticket url",
			);
		}
	});
});

describe("operate: kept across a restart", () => {
	it("stopped mid round 2's review, the next start goes on from round 2: no build runs again, no second pull request, one enqueue", async () => {
		const storage = memoryStorage();
		const before = world([failing, passing], {hold: 2});
		await once(before, storage, (run, _, close) =>
			Effect.gen(function* () {
				tell(run, "ticket", TICKET);
				close("ticket");
				// Round 2's reviewer has started, and does not answer.
				yield* before.held;
			}),
		);
		expect(before.writes.filter((x) => x.startsWith("open"))).toHaveLength(2);

		// The next start is told nothing: it finds the loop where it stood.
		const after = world([passing]);
		const end = await once(after, storage, (_, heard) =>
			heard.ended.upTo(1).pipe(Effect.map(([e]) => e as Ended)),
		);
		expect(end.name).toBe("done");
		expect(end.rounds.map((r) => r.n)).toEqual([1, 2]);
		expect(after.briefs).toEqual([]);
		expect(after.writes.filter((x) => x.startsWith("open") || x.startsWith("push"))).toEqual([]);
		expect(after.writes.filter((x) => x.startsWith("enqueue"))).toHaveLength(1);
	});

	it("three tickets told and the input closed, stopped in the first one's review: the next start, told nothing, ends every loop, the first from where it stood", async () => {
		const storage = memoryStorage();
		const tickets = [1, 2, 3].map((n) => `${REPO}/issues/${n}`);
		const before = world([passing], {hold: 1});
		await once(before, storage, (run, _, close) =>
			Effect.gen(function* () {
				for (const t of tickets) tell(run, "ticket", t);
				close("ticket");
				yield* before.held;
			}),
		);
		expect(before.briefs.map((b) => b.ticket)).toEqual([tickets[0]]);

		const after = world([passing]);
		const ended = await once(after, storage, (run, heard) =>
			run.ended.pipe(
				Effect.map((how) => [
					how.kind === "failed" ? String(how.cause) : how.kind,
					...heard.ended.values.map((e) => `${e.ticket} ${e.name}`),
				]),
			),
		);
		expect(ended).toEqual(["ended", ...tickets.map((t) => `${t} done`)]);
		// The first ticket's build is not run again; the two that waited are built once each.
		expect(after.briefs.map((b) => b.ticket)).toEqual(tickets.slice(1));
		expect(after.writes.filter((x) => x.startsWith("enqueue"))).toHaveLength(3);
	});
});

describe("operate killed (kill -9) twice and started again: the user's job", () => {
	const TICKETS = [1, 2, 3].map((n) => `${REPO}/issues/${n}`);
	const prOf = (n: number) => `${REPO}/pull/${1000 + n}`;
	/** Every write the world took, across every life, in order. Only a live process adds to it. */
	const log: string[] = [];
	const times = (line: string) => log.filter((l) => l === line).length;

	/**
	 * The world one life writes to. `reviewHeld`: the pull request whose review
	 * never answers, with `reviewing` done once it has started. `queueHeld`: the
	 * one the merge queue holds.
	 */
	const worldOf = (
		alive: () => boolean,
		more: {readonly reviewHeld?: string; readonly queueHeld?: string} = {},
	) => {
		const note = (line: string) => {
			if (alive()) log.push(line);
		};
		const reviewing = Deferred.makeUnsafe<void>();
		let current = "";
		const host = Layer.succeed(CodeHost, {
			prFacts: () => Effect.succeed(clear),
			change: (pr, head) => {
				const {gh} = recordedGh("final", {now: HEADS.final, change: opened});
				return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
			},
			checksSettled: () => Stream.make(undefined),
			leftQueue: (pr) =>
				pr === more.queueHeld
					? Stream.never
					: Stream.make({reading: "landed" as const, commit: "c".repeat(40)}),
		});
		const shipWrites = Layer.succeed(CodeHostWrites, {
			enqueue: (pr) => Effect.sync(() => note(`enqueue ${pr}`)).pipe(Effect.as("queued" as const)),
			merge: () => Effect.die("this repository has a merge queue"),
			rerunChecks: () => Effect.die("no checks are red here"),
		});
		const buildHost = Layer.succeed(BuildHost, {
			ticket: (url, number) => Effect.succeed({...ticket, url, number}),
		});
		const buildWrites = Layer.succeed(BuildWrites, {
			copy: (_, number) =>
				Effect.succeed({
					tree: `/work/trees/${number}`,
					branch: `build/${number}`,
					base: "b".repeat(40),
				}),
			push: (url) =>
				Effect.sync(() => note(`push ${url}`)).pipe(
					Effect.as({head: "h".repeat(40), changed: true}),
				),
			open: (url, number) => Effect.sync(() => note(`open ${url}`)).pipe(Effect.as(prOf(number))),
		});
		const reviewWrites = Layer.succeed(ReviewWrites, {
			post: (v) => Effect.sync(() => note(`post ${v.pr} ${v.kind}`)),
		});
		const builder = scriptedBuilder((brief) => built(builtBy(`round ${brief.round}`)));
		const reviewer = scriptedReviewer(drafts(passing), {
			notes: (brief) => {
				current = brief.pr;
				note(`review ${brief.pr}`);
				return [];
			},
			hold: Effect.suspend(() =>
				current === more.reviewHeld
					? Deferred.succeed(reviewing, undefined).pipe(Effect.andThen(Effect.never))
					: Effect.void,
			),
		});
		const services = Layer.mergeAll(
			host,
			shipWrites,
			buildHost,
			buildWrites,
			reviewWrites,
			builder.layer,
			reviewer.layer,
		);
		return {services, reviewing: Deferred.await(reviewing)};
	};

	/** One life of the process on the shared disk: `body` runs, then the process is gone. */
	const lifeOn = <A>(
		disk: ReturnType<typeof mortalDisk>,
		more: {readonly reviewHeld?: string; readonly queueHeld?: string},
		body: (
			run: OperateRun,
			parts: {
				readonly close: (name: "ticket") => void;
				readonly kill: () => void;
				readonly reviewing: Effect.Effect<void>;
			},
		) => Effect.Effect<A>,
	) => {
		const life = disk.life();
		let dead = false;
		const kill = () => {
			life.kill();
			dead = true;
		};
		const w = worldOf(() => !dead, more);
		const ended: string[] = [];
		return Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(
					operateProgram,
					FLAGS,
					{
						ended: (e) => {
							if (!dead) ended.push(`${e.ticket} ${e.name}`);
						},
					},
					{id: "operate:kill", storage: life.storage},
				);
				if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
				const result = yield* body(started.run, {
					close: started.close,
					kill,
					reviewing: w.reviewing,
				});
				return {result, ended, storage: life.storage};
			}).pipe(Effect.scoped, Effect.provide(w.services), Effect.timeout("5 seconds")),
		);
	};

	it("three tickets, killed mid review of the first and again mid ship of the second: no write goes twice, each loop ends done once, and nothing is left kept", async () => {
		const disk = mortalDisk();

		// Life 1: three tickets told and the input closed; killed while the first one's reviewer works.
		const one = await lifeOn(disk, {reviewHeld: prOf(1)}, (run, {close, kill, reviewing}) =>
			Effect.gen(function* () {
				for (const t of TICKETS) tell(run, "ticket", t);
				close("ticket");
				yield* reviewing;
				kill();
			}),
		);

		// Life 2, told nothing: the first goes on from its review and ships; killed with the second in
		// the merge queue.
		const two = await lifeOn(disk, {queueHeld: prOf(2)}, (run, {kill}) =>
			run.machines.ship.changes.pipe(
				Stream.filter((s) => s?.phase === "queued" && s.pr === prOf(2)),
				Stream.take(1),
				Stream.runDrain,
				Effect.andThen(Effect.sync(kill)),
			),
		);

		// Life 3, told nothing: every loop is taken to its end.
		const three = await lifeOn(disk, {}, (run) => run.ended);

		expect(three.result).toEqual({kind: "ended", unread: {}});
		expect({one: one.ended, two: two.ended, three: three.ended}).toEqual({
			one: [],
			two: [`${TICKETS[0]} done`],
			three: [`${TICKETS[1]} done`, `${TICKETS[2]} done`],
		});
		for (const [i, t] of TICKETS.entries()) {
			const pr = prOf(i + 1);
			expect(
				[
					times(`push ${t}`),
					times(`open ${t}`),
					times(`post ${pr} review-code`),
					times(`enqueue ${pr}`),
				],
				t,
			).toEqual([1, 1, 1, 1]);
		}
		// The first ticket's reviewer was cut off by the kill, and ran again: the only thing that did.
		expect(times(`review ${prOf(1)}`)).toBe(2);
		expect([times(`review ${prOf(2)}`), times(`review ${prOf(3)}`)]).toEqual([1, 1]);
		const left = await Effect.runPromise(three.storage.record("operate:kill"));
		expect(left?.machines).toEqual([]);
	});

	it("a ticket piped in from another program, killed before operate's queue kept it: it comes again, and is built, reviewed and shipped once", async () => {
		const disk = mortalDisk();
		const t = `${REPO}/issues/4`;
		const pr = prOf(4);
		/** An upstream: hands on each ticket it is told, as `tickets | operate`. */
		const tickets = defineProgram({
			name: "tickets",
			description: "Hands on each ticket it is told.",
			inputs: {ticket: input(TicketUrl, "A ticket to hand on.")},
			outputs: {ticket: output(TicketUrl, "Each ticket, as it was told.")},
			main: ({inputs, send}) => inputs.ticket.pipe(Stream.runForEach((x) => send("ticket", x))),
		});
		/** One life of the process, `tickets | operate` on the shared disk. Armed, operate's queue writes stall. */
		const pipedLife = <A>(
			body: (parts: {
				readonly operate: OperateRun;
				readonly up: RunningOf<typeof tickets>;
				readonly arm: () => void;
				readonly stalled: Effect.Effect<void>;
				readonly kill: () => void;
			}) => Effect.Effect<A>,
		) => {
			let dead = false;
			let armed = false;
			const stalled = Deferred.makeUnsafe<void>();
			// Let go once the process is gone, so its scope can close: a write let go then never lands.
			const gone = Deferred.makeUnsafe<void>();
			const life = disk.life((key) =>
				armed && key?.includes("/machine/queue/") === true
					? Deferred.succeed(stalled, undefined).pipe(Effect.andThen(Deferred.await(gone)))
					: Effect.void,
			);
			const w = worldOf(() => !dead);
			const ended: string[] = [];
			return Effect.runPromise(
				Effect.gen(function* () {
					const operate = yield* start(
						operateProgram,
						FLAGS,
						{
							ended: (e) => {
								if (!dead) ended.push(`${e.ticket} ${e.name}`);
							},
						},
						{id: "operate:piped", storage: life.storage},
					);
					if (operate.kind !== "running") return yield* Effect.die("operate did not start");
					const up = yield* pipe(
						{program: tickets, flags: {}, keeping: {id: "tickets:piped", storage: life.storage}},
						"ticket",
						operate,
						"ticket",
					);
					if (up.kind !== "running") return yield* Effect.die("tickets did not start");
					const result = yield* body({
						operate: operate.run,
						up,
						arm: () => {
							armed = true;
						},
						stalled: Deferred.await(stalled),
						kill: () => {
							life.kill();
							dead = true;
							Deferred.doneUnsafe(gone, Effect.void);
						},
					});
					return {result, ended};
				}).pipe(Effect.scoped, Effect.provide(w.services), Effect.timeout("5 seconds")),
			);
		};

		// Life 1: the ticket is told upstream and sent down the pipe; operate's queue is about to keep it
		// when the process is killed.
		const one = await pipedLife(({operate, up, arm, stalled, kill}) =>
			Effect.gen(function* () {
				while (operate.machines.queue.copies().length === 0) yield* Effect.sleep("1 millis");
				arm();
				expect(tell(up.run, "ticket", t)).toBe("queued");
				up.close("ticket");
				yield* stalled;
				kill();
			}),
		);

		// Life 2, told nothing: what upstream sent and operate never acked comes again.
		const two = await pipedLife(({operate, up}) =>
			Effect.all([up.run.ended, operate.ended], {concurrency: "unbounded"}).pipe(
				Effect.map(([a, b]) => [a.kind, b.kind]),
			),
		);

		expect({one: one.ended, two: two.ended, ends: two.result}).toEqual({
			one: [],
			two: [`${t} done`],
			ends: ["ended", "ended"],
		});
		expect([
			times(`push ${t}`),
			times(`open ${t}`),
			times(`post ${pr} review-code`),
			times(`enqueue ${pr}`),
		]).toEqual([1, 1, 1, 1]);
	});
});
