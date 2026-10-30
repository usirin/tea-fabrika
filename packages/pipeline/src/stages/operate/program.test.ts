import {
	defineProgram,
	ear,
	input,
	memoryStorage,
	mortalDisk,
	output,
	pipe,
	type RunningOf,
	type RunOf,
	type Storage,
	start,
	tell,
} from "@kampus/fabrika";
import {Deferred, Effect, Fiber, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {holderOf, layerLanes} from "../../asks/claims.ts";
import {type Ledger, memoryLedger, ticketName} from "../../asks/ledger.ts";
import {codeHostOn} from "../../code-host-github.ts";
import {memoryRecord} from "../../criteria/record.ts";
import {criterionId, ticketId} from "../../ids.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import {buildProgram} from "../build/program.ts";
import {built, builtBy, scriptedBuilder} from "../build/scripted.ts";
import {BuildHost, BuildWrites} from "../build/services.ts";
import {type Ticket, TicketUrl} from "../build/ticket.ts";
import type {Brief} from "../review/gate.ts";
import {criteriaIn} from "../review/pack.ts";
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
import type {PrFacts} from "../ship/facts.ts";
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
/** The ticket the recorded pull request's body closes ("Fixes #625"): the one its review keeps rows for, and ship reads. */
const SERVES = "kamp-us/tea-fabrika-sandbox#625";
const FLAGS = {
	rubrics: RUBRICS,
	model: "opus",
	effort: "medium",
	budget: 1,
	ship: "write",
	agents: {},
} as const;

const C4 = criterionId("c4");

const ticket: Ticket = {
	url: TICKET,
	number: 1,
	state: "open",
	title: "stop() hangs when the store's save never ends",
	body: "- [ ] it ends",
	plan: "approved",
	criteria: [{id: criterionId("c1"), version: 1, text: "it ends", checked: false, evidence: null}],
	prs: [],
	rules: [],
};

/** A pull request ship would land, once the review has kept a passing row per criterion at its head. */
const clear: PrFacts = {
	head: HEADS.final,
	state: "open",
	ours: true,
	ticket: {id: SERVES, link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: {tested: "main0", tip: "main0"},
};

const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		id: criterion.id,
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
		row.id === C4
			? {id: C4, grade: "fail" as const, where: [], says: "The reference page does not name it."}
			: row,
	),
	findings: [
		{
			kind: "review-doc",
			from: {source: "criterion", id: C4},
			fault: "The CLI reference does not name exit 3.",
			at: null,
			proof: "Grep finds no `3` in the exits table.",
			wants: "The page names exit 3.",
		},
	],
});
/** The brief's first `n` criteria fail, each with a finding that says what would close it. */
const failingFirst =
	(n: number) =>
	(brief: Brief): Form => {
		const failed = new Set(brief.criteria.slice(0, n).map((c) => c.id));
		return {
			...passing(brief),
			rows: passing(brief).rows.map((row) =>
				failed.has(row.id)
					? {id: row.id, grade: "fail" as const, where: [], says: "It does not."}
					: row,
			),
			findings: [...failed].map((id) => ({
				kind: "review-doc" as const,
				from: {source: "criterion" as const, id},
				fault: `Criterion ${id} is not met.`,
				at: null,
				proof: "Read the change.",
				wants: `Criterion ${id} is met.`,
			})),
		};
	};
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
function world(
	reviews: readonly ((brief: Brief) => Form)[],
	more: {readonly hold?: number; readonly ledger?: Layer.Layer<Ledger>} = {},
) {
	const writes: string[] = [];
	const posted: Verdict[] = [];
	let pushes = 0;
	let reviewed = 0;
	const held = Deferred.makeUnsafe<void>();
	const host = Layer.succeed(CodeHost, {
		pullRequests: () => Effect.succeed([]),
		prFacts: () => Effect.succeed(clear),
		change: (pr, head) => {
			const {gh} = recordedGh("final", {now: HEADS.final, change: opened});
			return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
		},
		checksSettled: () => Stream.make(undefined),
		leftQueue: () => Stream.make({reading: "landed" as const, commit: "c".repeat(40)}),
	});
	const shipWrites = Layer.succeed(CodeHostWrites, {
		enqueue: (ready) => {
			writes.push(`enqueue ${ready.pr} ${ready.head}`);
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
				// Each push brings the pull request to the head the review reads: the loop ships only a pass at the head it built.
				return {head: HEADS.final, changed: true};
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
	// The review keeps its rows here, and ship reads them back.
	const record = memoryRecord();
	const services = Layer.mergeAll(
		host,
		shipWrites,
		buildHost,
		buildWrites,
		reviewWrites,
		builder.layer,
		reviewer.layer,
		record.layer,
		// Who holds which ticket: this start's leases on the ledger. A test that runs several starts on
		// one ticket shares one ledger.
		lanesOn(more.ledger ?? memoryLedger().layer),
	);
	return {
		services,
		writes,
		posted,
		briefs: builder.briefs,
		held: Deferred.await(held),
		book: () => record.book(ticketId(SERVES)),
	};
}

/**
 * How long a lease lives here: short, so a start after a kill waits its old lease out within the
 * test's time, and long enough that a run told the ticket just after the kill still finds it held.
 */
const TTL_MS = 1500;
/** One start's leases (one process's), on a ledger the starts may share. */
const lanesOn = (ledger: Layer.Layer<Ledger>) =>
	layerLanes({ttlMs: TTL_MS}).pipe(Layer.provideMerge(ledger));
/** The lane that holds `ticket`'s lease now, read from the ledger. */
const holderNow = (ledger: Layer.Layer<Ledger>, ticket: string) =>
	Effect.runSync(holderOf(ticketId(ticket)).pipe(Effect.provide(ledger)));

type OperateRun = RunOf<typeof operateProgram>;
type Heard = {
	readonly steps: ReturnType<typeof ear<Step>>;
	readonly ended: ReturnType<typeof ear<Ended>>;
};

/** One start of the run on `storage` under one id: `body` runs, then the scope closes, as a crash would close it. */
const once = <A, E>(
	w: ReturnType<typeof world>,
	storage: Storage,
	body: (run: OperateRun, heard: Heard, close: (name: "ticket") => void) => Effect.Effect<A, E>,
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
		}).pipe(Effect.scoped, Effect.provide(w.services)),
	);

/** Tell it the ticket, close its input, and hear how the loop ended. */
const toTheEnd = (run: OperateRun, heard: Heard, close: (name: "ticket") => void) =>
	Effect.gen(function* () {
		expect(yield* tell(run, "ticket", TICKET)).toBe("queued");
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
		expect(w.briefs[1]?.open).toMatchObject([{criterion: "c4", wants: ["The page names exit 3."]}]);
		// One pull request, brought up to date each round; a FAIL then a PASS posted; one enqueue.
		expect(w.writes.filter((x) => x.startsWith("open"))).toEqual([`open ${PR}`, `open ${PR}`]);
		expect(w.posted.map((p) => p.verdict)).toContain("fail");
		expect(w.posted.at(-1)?.verdict).toBe("pass");
		expect(w.writes.filter((x) => x.startsWith("enqueue"))).toEqual([
			`enqueue ${PR} ${HEADS.final}`,
		]);
		// Ship merged on the rows the reviews kept: round 1's fail on c4, then round 2's pass on every criterion.
		const rows = w.book()?.verdicts ?? [];
		expect(rows.filter((v) => v.grade === "fail").map((v) => v.criterion)).toEqual([C4]);
		expect(new Set(rows.slice(-5).map((v) => `${v.criterion} ${v.grade} ${v.head}`))).toEqual(
			new Set(["c1", "c2", "c3", "c4", "c5"].map((id) => `${id} pass ${HEADS.final}`)),
		);
		const again = [await run(), await run()].map((r) => r.end);
		expect(again).toEqual([end, end]);
	});

	it("the stop rule: one round that leaves the open list no smaller earns one more; the second in a row stops the loop, says so, and ships nothing", async () => {
		const w = world([failing]);
		const end = await once(w, memoryStorage(), toTheEnd);
		expect(end.outcome).toEqual({kind: "ask", who: "owner", for: "no_progress"});
		expect(end.said).toBe("send:builder:review_failed");
		expect(end.rounds.map((r) => r.open)).toEqual([1, 1, 1]);
		expect(w.writes.filter((x) => x.startsWith("enqueue"))).toEqual([]);
	});

	it("a review whose form code refuses twice ends the loop stuck, and the step, the end and its round all say why, in the Check's words", async () => {
		// No rows: every criterion is missing its row, on both tries.
		const refused = (): Form => ({rows: [], findings: [], skipped: []});
		const w = world([refused]);
		const steps = await once(w, memoryStorage(), (run, heard, close) =>
			toTheEnd(run, heard, close).pipe(
				Effect.map((end) => ({end, review: heard.steps.values.find((s) => s.stage === "review")})),
			),
		);
		const {end, review} = steps;
		// The criteria the review grades are the recorded pull request's ticket's.
		const criteria = criteriaIn(recorded("tickets/625.md")) ?? [];
		const why = criteria.map((c) => `form 1 refused: criterion ${c.id} has no row`);
		const second = criteria.map((c) => `form 2 refused: criterion ${c.id} has no row`);
		expect(end.outcome).toEqual({kind: "stuck", why: "review"});
		expect(review?.name).toBe("stuck:draft_failed");
		expect(review?.problems).toEqual([...why, ...second]);
		// Kept past the tidy-up that clears the review's own state: the round holds them too.
		expect(end.rounds[0]?.problems).toEqual([...why, ...second]);
		// Both tries were paid for, and both are counted.
		expect(review?.spend).toBeCloseTo(2 * RAN.spend.costUsd);
		expect(w.writes.filter((x) => x.startsWith("enqueue"))).toEqual([]);
	});

	it("no cap on rounds: a list that gets one shorter each round goes on for five rounds, asks the owner nothing, and ships", async () => {
		const w = world([failingFirst(4), failingFirst(3), failingFirst(2), failingFirst(1), passing]);
		const end = await once(w, memoryStorage(), toTheEnd);
		expect(end.outcome).toMatchObject({kind: "done", pr: PR, rounds: 5});
		expect(end.rounds.map((r) => r.open)).toEqual([4, 3, 2, 1, 0]);
		expect(w.briefs.map((b) => b.open.length)).toEqual([0, 4, 3, 2, 1]);
		expect(w.writes.filter((x) => x.startsWith("enqueue"))).toEqual([
			`enqueue ${PR} ${HEADS.final}`,
		]);
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
		expect(said(1, "review")).toEqual([expect.stringMatching(/^`c4 v1` .+: .+/)]);
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
			"#1: claiming it as L1",
			"#1 round 1: building",
			"#1 round 1: reviewing PR #9",
			"#1 round 1: posting the review on PR #9",
			"#1 round 2: building",
			"#1 round 2: reviewing PR #9",
			"#1 round 2: posting the review on PR #9",
			"#1: shipping PR #9",
			"#1: letting it go",
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
			Effect.all(
				[
					tell(run, "ticket", "https://github.com/acme/widgets/pull/691"),
					tell(run, "ticket", "https://github.com/acme/widgets/issues/1?x"),
				],
				{concurrency: 1},
			),
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

describe("operate: one ticket, several runs, one ledger", () => {
	it("three runs told the same ticket at once: one works it, two end skip:claimed and write nothing; killed, it still holds it; started again it ships and lets it go, and a fourth run then takes it; three times over", async () => {
		for (let time = 0; time < 3; time++) {
			const ledger = memoryLedger();
			const worlds = [0, 1, 2].map(() => world([passing], {hold: 1, ledger: ledger.layer}));
			const storages = worlds.map(() => memoryStorage());
			const first = await Promise.all(
				worlds.map((w, i) =>
					once(w, storages[i] as Storage, (run, heard, close) =>
						Effect.gen(function* () {
							yield* tell(run, "ticket", TICKET);
							close("ticket");
							// The one that works it reaches its review, which never answers; then it is killed.
							return yield* Effect.raceFirst(
								heard.ended.upTo(1).pipe(Effect.map(([e]) => (e as Ended).name as string)),
								w.held.pipe(Effect.as("working")),
							);
						}),
					),
				),
			);
			expect([...first].sort()).toEqual(["skip:claimed", "skip:claimed", "working"]);
			const at = first.indexOf("working");
			worlds.forEach((w, i) => {
				if (i === at) return;
				expect(w.writes).toEqual([]);
				expect(w.briefs).toEqual([]);
			});

			// Killed mid review, it still holds the ticket: a run told it now is refused too.
			const late = world([passing], {ledger: ledger.layer});
			expect((await once(late, memoryStorage(), toTheEnd)).name).toBe("skip:claimed");
			expect(late.writes).toEqual([]);

			// Started again on its own storage, it goes on as the same lane, ships, and lets the ticket go.
			const again = world([passing], {ledger: ledger.layer});
			const end = await once(again, storages[at] as Storage, (_, heard) =>
				heard.ended.upTo(1).pipe(Effect.map(([e]) => e as Ended)),
			);
			expect(end.name).toBe("done");
			expect(again.writes.filter((x) => x.startsWith("enqueue"))).toHaveLength(1);
			expect(holderNow(ledger.layer, TICKET)).toBeNull();

			// A fourth run, after, takes the ticket and works it.
			const fourth = world([passing], {ledger: ledger.layer});
			expect((await once(fourth, memoryStorage(), toTheEnd)).name).toBe("done");
			expect(fourth.briefs).toHaveLength(1);
		}
	});
});

describe("operate: kept across a restart", () => {
	it("stopped mid round 2's review, the next start goes on from round 2: no build runs again, no second pull request, one enqueue", async () => {
		const storage = memoryStorage();
		// The ledger outlives the process, as the storage does: the lane still holds its ticket.
		const {layer: ledger} = memoryLedger();
		const before = world([failing, passing], {hold: 2, ledger});
		await once(before, storage, (run, _, close) =>
			Effect.gen(function* () {
				yield* tell(run, "ticket", TICKET);
				close("ticket");
				// Round 2's reviewer has started, and does not answer.
				yield* before.held;
			}),
		);
		expect(before.writes.filter((x) => x.startsWith("open"))).toHaveLength(2);

		// The next start is told nothing: it finds the loop where it stood.
		const after = world([passing], {ledger});
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
		const {layer: ledger} = memoryLedger();
		const before = world([passing], {hold: 1, ledger});
		await once(before, storage, (run, _, close) =>
			Effect.gen(function* () {
				for (const t of tickets) yield* tell(run, "ticket", t);
				close("ticket");
				yield* before.held;
			}),
		);
		expect(before.briefs.map((b) => b.ticket)).toEqual([tickets[0]]);

		const after = world([passing], {ledger});
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
	/** The criteria record, kept outside the process as the ledger is: a review's rows outlive the life that wrote them. */
	const kept = memoryRecord();
	/** Who holds which ticket, kept outside the process too: a lane killed mid way still holds its ticket. */
	const claims = memoryLedger();

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
			pullRequests: () => Effect.succeed([]),
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
			enqueue: (ready) =>
				Effect.sync(() => note(`enqueue ${ready.pr}`)).pipe(Effect.as("queued" as const)),
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
				Effect.sync(() => note(`push ${url}`)).pipe(Effect.as({head: HEADS.final, changed: true})),
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
			kept.layer,
			lanesOn(claims.layer),
		);
		return {services, reviewing: Deferred.await(reviewing)};
	};

	/** One life of the process on the shared disk: `body` runs, then the process is gone. */
	const lifeOn = <A, E>(
		disk: ReturnType<typeof mortalDisk>,
		more: {readonly reviewHeld?: string; readonly queueHeld?: string},
		body: (
			run: OperateRun,
			parts: {
				readonly close: (name: "ticket") => void;
				readonly kill: () => void;
				readonly reviewing: Effect.Effect<void>;
			},
		) => Effect.Effect<A, E>,
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
			}).pipe(Effect.scoped, Effect.provide(w.services)),
		);
	};

	it("three tickets, killed mid review of the first and again mid ship of the second: no write goes twice, each loop ends done once, and nothing is left kept", async () => {
		const disk = mortalDisk();

		// Life 1: three tickets told and the input closed; killed while the first one's reviewer works.
		const one = await lifeOn(disk, {reviewHeld: prOf(1)}, (run, {close, kill, reviewing}) =>
			Effect.gen(function* () {
				for (const t of TICKETS) yield* tell(run, "ticket", t);
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
		// Each loop held its ticket across the kills as one lane, and let it go once it ended. A lane
		// killed holding its ticket claims it again, as itself, once its old lease has run out: the
		// first ticket in life 2, the second in life 3.
		const claimedBy = (t: string) =>
			claims
				.rows()
				.filter((r) => r.stream === ticketName(ticketId(t)) && r.kind === "claimed")
				.map((r) => r.writer);
		expect(TICKETS.map((t) => claimedBy(t).length)).toEqual([2, 2, 1]);
		expect(TICKETS.map((t) => new Set(claimedBy(t)).size)).toEqual([1, 1, 1]);
		expect(TICKETS.map((t) => holderNow(claims.layer, t))).toEqual([null, null, null]);
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
			main: ({serve, send}) => serve({ticket: (x) => send("ticket", x)}),
		});
		/** One life of the process, `tickets | operate` on the shared disk. Armed, operate's queue writes stall. */
		const pipedLife = <A, E>(
			body: (parts: {
				readonly operate: OperateRun;
				readonly up: RunningOf<typeof tickets>;
				readonly arm: () => void;
				readonly stalled: Effect.Effect<void>;
				readonly kill: () => void;
			}) => Effect.Effect<A, E>,
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
				}).pipe(Effect.scoped, Effect.provide(w.services)),
			);
		};

		// Life 1: the ticket is told upstream and sent down the pipe; operate's queue is about to keep it
		// when the process is killed.
		const one = await pipedLife(({operate, up, arm, stalled, kill}) =>
			Effect.gen(function* () {
				while (operate.machines.queue.copies().length === 0) yield* Effect.sleep("1 millis");
				arm();
				expect(yield* tell(up.run, "ticket", t)).toBe("queued");
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
