// Experiment 104's world, as a host process sees it: `Outside` and the stages' read services over
// the fake code host (./fake-github.ts, in the harness process), and scripted agents. Every
// scripted agent takes 300 ms and bills a fixed sum, so a kill 100 ms into a turn lands inside it,
// and a wasted turn shows on the ledger's bill.
import {Duration, Effect, FileSystem, Layer, Option, Schedule, Schema, Stream} from "effect";
import {CriteriaRecord} from "../../packages/fabrika/src/pipeline/criteria/record.ts";
import type {Spend} from "../../packages/fabrika/src/pipeline/draft.ts";
import {type Key, useKey} from "../../packages/fabrika/src/pipeline/hosted/idempotency.ts";
import {type Landing, marked, Outside} from "../../packages/fabrika/src/pipeline/hosted/outside.ts";
import {criterionId} from "../../packages/fabrika/src/pipeline/ids.ts";
import {CodeHost} from "../../packages/fabrika/src/pipeline/services.ts";
import {Builder} from "../../packages/fabrika/src/pipeline/stages/build/form.ts";
import {builtBy} from "../../packages/fabrika/src/pipeline/stages/build/scripted.ts";
import {BuildHost} from "../../packages/fabrika/src/pipeline/stages/build/services.ts";
import {READY, type Ticket} from "../../packages/fabrika/src/pipeline/stages/build/ticket.ts";
import type {PlanDraft} from "../../packages/fabrika/src/pipeline/stages/plan/plan.ts";
import {
	PlanFacts,
	PlanHost,
	type PlanMsg,
	Planner,
	type PlanTicket,
} from "../../packages/fabrika/src/pipeline/stages/plan/services.ts";
import type {Brief} from "../../packages/fabrika/src/pipeline/stages/review/gate.ts";
import type {Drafted, Form} from "../../packages/fabrika/src/pipeline/stages/review/reviewer.ts";
import {
	changed,
	HEADS,
	PR as REVIEW_PR,
	recorded,
	recordedGh,
	recordedHost,
	scriptedReviewer,
} from "../../packages/fabrika/src/pipeline/stages/review/scripted.ts";
import type {PrFacts} from "../../packages/fabrika/src/pipeline/stages/ship/facts.ts";
import {
	ON_TIP,
	provenAt,
	TICKET,
} from "../../packages/fabrika/src/pipeline/stages/ship/scripted.ts";

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** The pull requests the fake starts each run with. */
export const SHIP_PR = "https://github.com/example/repo/pull/629";
export const SHIP_HEAD = "abc1234def5678";
export const FIXTURES = [
	{number: 628, branch: "review-fixture", head: HEADS.final},
	{number: 629, branch: "ship-fixture", head: SHIP_HEAD},
] as const;
export {REVIEW_PR};
export const BUILD_TICKET = "https://github.com/example/repo/issues/1";
export const PLAN_TICKET = "https://github.com/example/repo/issues/7";

/** What one scripted turn bills. */
export const TURN_USD = 0.1;
const TURN = Duration.millis(300);
const spendOf = (usd: number): Spend => ({
	costUsd: usd,
	tokens: 100,
	context: 50,
	turns: 2,
	minutes: 0.01,
});
const ran = (usd: number) => ({spend: spendOf(usd), tools: [], refused: [], links: 0});

// ---------------------------------------------------------------- the fake, over HTTP

const call = (fake: string, body: Record<string, unknown>) =>
	Effect.tryPromise({
		try: async () => {
			const res = await fetch(`${fake}/call`, {method: "POST", body: JSON.stringify(body)});
			const json: {answer?: unknown} = await res.json();
			return json.answer;
		},
		catch: (): Failed => ({_tag: "unknown"}),
	});
const read = (fake: string, fn: string, args: Record<string, unknown>) => call(fake, {fn, args});
/** A write with its key: the key's text, and the name and fence it was made under. */
const send = (fake: string, fn: string, key: Key, args: Record<string, unknown>) =>
	useKey(key).pipe(
		Effect.flatMap((text) => call(fake, {fn, args, key: text, name: key.name, fence: key.fence})),
	);
/** The planted mistake: a write sent to the code host with no key at all. */
export const rawWrite = (fake: string, fn: string, args: Record<string, unknown>) =>
	call(fake, {fn, args});

const Url = Schema.Struct({url: Schema.String});
const LandingOf = Schema.Union([
	Schema.Struct({at: Schema.Literals(["none", "queued"])}),
	Schema.Struct({at: Schema.Literals(["merged"]), commit: Schema.String}),
]);
const Enqueued = Schema.Struct({
	answer: Schema.Literals(["queued", "head_moved", "conflicts", "no_queue"]),
});
const Merge = Schema.Union([
	Schema.Struct({reading: Schema.Literals(["merged"]), commit: Schema.String}),
	Schema.Struct({reading: Schema.Literals(["head_moved", "conflicts"])}),
]);
const Ok = Schema.Struct({ok: Schema.Boolean});
const Reruns = Schema.Array(Schema.Struct({run: Schema.Number, attempt: Schema.Number}));
const as =
	<A>(schema: Schema.Codec<A, unknown>) =>
	(u: unknown) =>
		Schema.decodeUnknownEffect(schema)(u).pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));

/** `Outside` over the fake. `remote`: the bare repository this run's pushes go to. */
export const fakeOutside = (fake: string, remote: string) =>
	Layer.succeed(
		Outside,
		Outside.of({
			remote: () => remote,
			branchHead: (_repo, branch) =>
				read(fake, "branchHead", {branch}).pipe(
					Effect.map((h) => (typeof h === "string" ? h : null)),
				),
			prFrom: (_repo, branch) =>
				read(fake, "prFrom", {branch}).pipe(Effect.map((u) => (typeof u === "string" ? u : null))),
			hasComment: (pr, key) =>
				read(fake, "hasComment", {pr, key}).pipe(Effect.map((b) => b === true)),
			landing: (pr, head) =>
				read(fake, "landing", {pr, head}).pipe(
					Effect.flatMap(as(LandingOf)),
					Effect.map((l): Landing => l),
				),
			push: (key, at) =>
				send(fake, "push", key, {tree: at.tree, branch: at.branch, sha: at.sha}).pipe(
					Effect.flatMap(as(Ok)),
					Effect.flatMap((o) => (o.ok ? Effect.void : failed)),
				),
			open: (key, at) =>
				Effect.gen(function* () {
					const text = yield* useKey(key);
					const made = yield* send(fake, "open", key, {
						branch: at.branch,
						title: at.title,
						body: marked(at.body, text),
					});
					// A refusal (422: one pull request per branch) does not read as a url.
					return (yield* as(Url)(made)).url;
				}),
			comment: (key, pr, body) =>
				useKey(key).pipe(
					Effect.flatMap((text) => send(fake, "comment", key, {pr, body: marked(body, text)})),
					Effect.asVoid,
				),
			enqueue: (key, ready) =>
				send(fake, "enqueue", key, {pr: ready.pr, head: ready.head}).pipe(
					Effect.flatMap(as(Enqueued)),
					Effect.map((e) => e.answer),
				),
			merge: (key, ready) =>
				send(fake, "merge", key, {pr: ready.pr, head: ready.head}).pipe(Effect.flatMap(as(Merge))),
			rerunChecks: (key, pr, head) =>
				send(fake, "rerun", key, {pr, head}).pipe(Effect.flatMap(as(Reruns))),
		}),
	);

// ---------------------------------------------------------------- ship's reads

const clear = (head: string): PrFacts => ({
	head,
	state: "open",
	ours: true,
	ticket: {id: TICKET, link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: ON_TIP,
});
const PrRead = Schema.Struct({
	head: Schema.String,
	state: Schema.Literals(["open", "merged"]),
});

/** Ship's `CodeHost` over the fake; review reads the recorded pull request (628) instead. */
export const shipCodeHost = (fake: string) =>
	Layer.succeed(CodeHost, {
		prFacts: (pr) =>
			read(fake, "pr", {pr}).pipe(
				Effect.flatMap(as(PrRead)),
				Effect.map((p) => ({...clear(p.head), state: p.state})),
			),
		change: () => failed,
		checksSettled: () => Stream.succeed(undefined),
		leftQueue: (pr, head) =>
			Stream.fromEffect(
				read(fake, "landing", {pr, head}).pipe(
					Effect.flatMap(as(LandingOf)),
					Effect.flatMap((l) =>
						l.at === "merged"
							? Effect.succeed(Option.some(l.commit))
							: Effect.succeed(Option.none()),
					),
					Effect.orElseSucceed(() => Option.none<string>()),
					Effect.repeat({until: Option.isSome, schedule: Schedule.spaced(Duration.millis(100))}),
					Effect.map((c) => ({reading: "landed" as const, commit: Option.getOrElse(c, () => "")})),
				),
			),
	});

export const shipRecord = Layer.succeed(CriteriaRecord, {
	read: () => Effect.succeed(provenAt(SHIP_HEAD)),
	judged: () => Effect.void,
});

/** The recorded pull request (628), read as open at its final head: the recordings were made after it merged. */
export const reviewCodeHost = recordedHost(
	recordedGh("final", {
		change: changed(recorded("change-final.json"), (repo) => {
			repo.pullRequest.state = "OPEN";
			repo.pullRequest.headRefOid = HEADS.final;
		}),
	}).gh,
);

// ---------------------------------------------------------------- scripted agents

const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		id: criterion.id,
		grade: "pass" as const,
		where: [{file: "packages/code-graph/src/api/cli.ts", first: 1, last: 2}],
		says: "It does.",
		limit: null,
	})),
	findings: [],
	skipped: [{what: "The test run", why: "No shell."}],
});

/** The scripted reviewer: 300 ms, a passing form, $0.10. */
export const scriptedReview = scriptedReviewer(
	(brief): Drafted => ({answer: "form", form: passing(brief), ...ran(TURN_USD)}),
	{hold: Effect.sleep(TURN)},
).layer;

export const PLAN_TICKET_READ: PlanTicket = {
	url: PLAN_TICKET,
	number: 7,
	state: "open",
	title: "The slug keeps two dashes",
	body: "Two spaces make two dashes.",
	at: null,
};
const good: PlanDraft = {
	summary: "Two spaces in a title make two dashes in its slug.",
	stories: [{id: "s1", who: "a blog author", want: "clean slugs", why: "links read well"}],
	tasks: [
		{
			title: "One dash for any run of spaces",
			ends: "pr",
			job: {
				when: "someone makes slugs from fifty real titles, then from those slugs again",
				result: "every slug has single dashes, and the second pass gives the same slugs",
				fixture: "fifty titles, a fifth with runs of spaces, run twice",
				check: {how: "test", what: "a test slugs them twice"},
				serves: ["s1"],
			},
			criteria: [
				{
					when: "someone makes a slug from a title with two spaces in a row",
					result: "the slug has one dash where the spaces were",
					check: {how: "test", what: "a test slugs such a title"},
					serves: ["s1"],
				},
			],
		},
	],
	pointers: [{at: "src/slug.ts", why: "the slug is made here"}],
	questions: [],
};
/** The first draft names code in a criterion, so the refine loop asks a second time. */
const coded: PlanDraft = {
	...good,
	tasks: good.tasks.map((t) => ({
		...t,
		criteria: t.criteria.map((c) => ({...c, when: "slugOf gets two spaces"})),
	})),
};

/** The scripted planner: 300 ms, $0.10; a first draft that the loop sends back, then a good one. */
export const scriptedPlan = Layer.succeed(Planner, {
	run: (run) =>
		Stream.fromEffect(
			Effect.sleep(TURN).pipe(
				Effect.as<PlanMsg>({
					type: "plan_finished",
					key: run.key,
					id: run.id,
					output: run.session.continues ? good : coded,
					session: "s",
					spend: spendOf(TURN_USD),
				}),
			),
		),
});
export const planReads = Layer.mergeAll(
	Layer.succeed(PlanHost, {ticket: () => Effect.succeed(PLAN_TICKET_READ)}),
	Layer.succeed(PlanFacts, {
		gather: () => Effect.succeed({text: "src/slug.ts makes the slug", names: []}),
	}),
);

export const BUILD_TICKET_READ: Ticket = {
	url: BUILD_TICKET,
	number: 1,
	state: "open",
	title: "stop() hangs",
	body: "- [ ] it ends",
	labels: [READY],
	criteria: [{id: criterionId("c1"), version: 1, text: "it ends", checked: false, evidence: null}],
	prs: [],
	rules: [],
};
export const buildReads = Layer.succeed(BuildHost, {
	ticket: (url, number) => Effect.succeed({...BUILD_TICKET_READ, url, number}),
});

/** The scripted builder: 300 ms, one file changed in its copy, $0.10. */
export const scriptedBuild = Layer.effect(
	Builder,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return Builder.of({
			build: (brief) =>
				Effect.gen(function* () {
					yield* Effect.sleep(TURN);
					yield* fs
						.writeFileString(
							`${brief.tree}/src/slug.ts`,
							`export const slug = (t: string) => t.trim().replace(/\\s+/g, "-");\n// round ${brief.round}\n`,
						)
						.pipe(Effect.orDie);
					return {
						answer: "built" as const,
						built: builtBy("one dash for any run"),
						...ran(TURN_USD),
					};
				}),
		});
	}),
);
