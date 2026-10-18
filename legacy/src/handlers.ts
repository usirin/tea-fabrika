import type {Outcome} from "@demlik/tea";
import {decodeJevReply, type JevCmd, type JevQuestionMap, jevCallThrew} from "@demlik/tea/jev";
import {Effect, Option} from "effect";
import {Jev} from "../../wip/src/services";
import type {weigh} from "./comments";
import {
	Builder,
	CommentReader,
	Enricher,
	Facts,
	FailureReader,
	Matcher,
	MissingReader,
	PublishedApi,
	Repo,
	Reviewer,
	Router,
	Tracker,
	Workspace,
} from "./factory-services";
import type {gatherFacts} from "./facts";
import type {Issue} from "./issue";
import type {BuildVerdict, building, prepare} from "./lane";
import type {findMissing, inspect, match, route} from "./review";
import type {catchUp, land, retest, seal} from "./ship";
import type {fetchComments, fetchTicket} from "./tracker";
import type {enrichment} from "./triage";

/** A tea Outcome as an Effect: the engine mints `_ok` from success, `_err` from failure. */
const fromOutcome = <A, E>(outcome: Outcome<A, E>): Effect.Effect<A, E> =>
	outcome._tag === "Ok" ? Effect.succeed(outcome.value) : Effect.fail(outcome.error);

/** One call to Jev, decoded against the questions on its own request. */
const askJev = <Q extends JevQuestionMap, N extends string>(cmd: JevCmd<Q, N>) =>
	Effect.gen(function* () {
		const jev = yield* Jev;
		const outcome = yield* jev.call(cmd.input).pipe(
			Effect.match({
				onSuccess: (reply) => decodeJevReply(cmd.input, reply),
				onFailure: (failure) => jevCallThrew(failure.cause),
			}),
		);
		return yield* fromOutcome(outcome);
	});

/** Triage's handlers. */
export const triageInterpret = {
	fetch_ticket: (cmd: ReturnType<typeof fetchTicket>) =>
		Effect.gen(function* () {
			const tracker = yield* Tracker;
			return yield* tracker.ticket(cmd.issue);
		}),
	gather_facts: (cmd: ReturnType<typeof gatherFacts>) =>
		Effect.gen(function* () {
			return yield* (yield* Facts).gather(cmd.mentions);
		}),
	enrich_write: (cmd: ReturnType<typeof enrichment.write>) =>
		Effect.gen(function* () {
			const enricher = yield* Enricher;
			const {issue, session} = yield* enricher.enrich({
				raw: cmd.brief.raw,
				facts: cmd.brief.facts,
				note: cmd.note,
				session: cmd.session,
			});
			return {draft: issue, session};
		}),
	// Vetting is the workspace's: it knows the repo, and how the repo's tests are written and run.
	enrich_check: (cmd: ReturnType<typeof enrichment.check>) =>
		Effect.gen(function* () {
			return yield* (yield* Workspace).vet(cmd.draft);
		}),
	sort_run: askJev,
};

/** Review's handlers. */
export const reviewInterpret = {
	route: (cmd: ReturnType<typeof route>) =>
		Effect.gen(function* () {
			const router = yield* Router;
			const routed = yield* router.route({about: cmd.about, text: cmd.text, goal: cmd.goal});
			return {key: cmd.key, ...routed};
		}),
	inspect: (cmd: ReturnType<typeof inspect>) =>
		Effect.gen(function* () {
			const reviewer = yield* Reviewer;
			return yield* reviewer.review({
				issue: cmd.issue,
				diff: cmd.diff,
				open: cmd.open,
				decided: cmd.decided,
			});
		}),
	match: (cmd: ReturnType<typeof match>) =>
		Effect.gen(function* () {
			const matcher = yield* Matcher;
			const matched = yield* matcher.match({text: cmd.text, candidates: cmd.candidates});
			return {key: cmd.key, ...matched};
		}),
	find_missing: (cmd: ReturnType<typeof findMissing>) =>
		Effect.gen(function* () {
			return yield* (yield* MissingReader).find({
				issue: cmd.issue,
				diff: cmd.diff,
				changed: cmd.changed,
			});
		}),
};

/** The handlers for reading the owner's comments. */
export const commentInterpret = {
	fetch_comments: (cmd: ReturnType<typeof fetchComments>) =>
		Effect.gen(function* () {
			const tracker = yield* Tracker;
			return {comments: yield* tracker.comments(cmd.issue)};
		}),
	weigh: (cmd: ReturnType<typeof weigh>) =>
		Effect.gen(function* () {
			const reader = yield* CommentReader;
			const read = yield* reader.weigh({text: cmd.text, rules: cmd.rules}).pipe(
				// The lane learns which comment failed from the error, so only that one goes to a person.
				Effect.mapError((error) => ({...error, key: cmd.key})),
			);
			return {key: cmd.key, ...read};
		}),
};

/** The lane's handlers, review's among them. Each one only forwards a Cmd to the service behind it. */
export const interpret = {
	...reviewInterpret,
	...commentInterpret,
	prepare: (cmd: ReturnType<typeof prepare>) =>
		Effect.gen(function* () {
			const workspace = yield* Workspace;
			return yield* workspace.prepare(cmd.issue);
		}),
	// The lane names the conversation up front; only a run that has none yet starts it.
	build_write: (cmd: ReturnType<typeof building.write>) =>
		Effect.gen(function* () {
			const builder = yield* Builder;
			const {issue, session} = cmd.brief;
			const draft = yield* builder.build({
				issue,
				feedback: cmd.note,
				session: {id: session, continues: cmd.session !== null},
			});
			return {draft, session};
		}),
	build_check: (cmd: ReturnType<typeof building.check>) => checkBuild(cmd.brief.issue),
};

/** What a host with no package to compare reports. */
const NO_PACKAGE = {
	kind: "skipped",
	why: "no package to compare: the host gives no published-API check",
} as const;

/**
 * The build loop's checks, in order: the tests in the builder's folder (a
 * locked file changed is reported alone), the published API, then the tests
 * on a fresh copy of the change. A failed run is read for whose failure it
 * is: the Judge this Check calls. The workspace knows the command that ran it.
 * The tests include the checks the issue's criteria add: its type snippets and
 * its existing tests.
 */
const checkBuild = (issue: Issue) =>
	Effect.gen(function* () {
		const workspace = yield* Workspace;
		const ran = yield* workspace.check(issue);
		if (ran.touched.length > 0) return {kind: "touched", files: ran.touched} satisfies BuildVerdict;
		const published = yield* Effect.serviceOption(PublishedApi);
		const api = Option.isSome(published) ? yield* published.value.diff() : NO_PACKAGE;
		const reader = yield* FailureReader;
		const read = (output: string) =>
			reader.read({command: workspace.testCommand, diff: ran.diff, output}).pipe(
				// A reader that failed cannot say the builder is blameless: the lane reads it as unread.
				Effect.match({onSuccess: ({cause}) => cause, onFailure: () => "unread" as const}),
			);
		if (!ran.passed) {
			return {
				kind: "failed",
				step: "check",
				output: ran.output,
				diff: ran.diff,
				cause: yield* read(ran.output),
				api,
			} satisfies BuildVerdict;
		}
		const fresh = yield* workspace.freshCheck(issue);
		if (!fresh.passed) {
			return {
				kind: "failed",
				step: "fresh",
				output: fresh.output,
				diff: ran.diff,
				cause: yield* read(fresh.output),
				api,
			} satisfies BuildVerdict;
		}
		return {
			kind: "passed",
			diff: ran.diff,
			changed: ran.changed,
			snapshot: ran.snapshot,
			api,
		} satisfies BuildVerdict;
	});

/** Ship's handlers: each one forwards to the repo. */
export const shipInterpret = {
	seal: (cmd: ReturnType<typeof seal>) =>
		Effect.gen(function* () {
			return yield* (yield* Repo).seal(cmd.message);
		}),
	land: (cmd: ReturnType<typeof land>) =>
		Effect.gen(function* () {
			return yield* (yield* Repo).land(cmd.head);
		}),
	catch_up: (cmd: ReturnType<typeof catchUp>) =>
		Effect.gen(function* () {
			return yield* (yield* Repo).catchUp(cmd.head);
		}),
	retest: (cmd: ReturnType<typeof retest>) =>
		Effect.gen(function* () {
			return yield* (yield* Repo).retest(cmd.head);
		}),
};

/** The factory runs every machine, so it needs every set. */
export const factoryInterpret = {...triageInterpret, ...interpret, ...shipInterpret};
