// The writes a hosted stage makes on issues, and the reads that tell whether one was made already
// (experiment 111). The sort stage writes here: a comment, a label, a close. As on `Outside`
// (./outside.ts), every write takes a `Key` (./idempotency.ts), so a write with no key does not
// compile, and each implementation calls `useKey` before it sends: a forged key, or one whose send is
// over, is refused there, and nothing is sent.
//
// Its own service and not more of `Outside`: a stage that only sorts needs no push, no merge queue.
//
// A label and a close are the same however often they are sent: GitHub keeps one label of a name,
// and a closed issue stays closed. A comment is not: two sends are two comments. So the comment
// carries the key's marker, and the gate reads for it after a host died between its two rows.
//
// Two implementations: GitHub (below, gh on this machine, for the sandbox runs) and experiment 111's
// fake (experiments/111-sort-on-tea-host/world.ts).
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {hostEnv} from "@kampus/fabrika-old/agents/sandbox";
import {Context, Effect, Layer, Schema} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {runChild} from "../child.ts";
import {answerOf, type Gh} from "../code-host-github.ts";
import {ticketOf} from "../stages/build/ticket.ts";
import {type Key, type KeyRefused, markerOf, useKey} from "./idempotency.ts";
import {marked} from "./outside.ts";

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** How an issue is closed: GitHub's own reasons, of those sort gives. */
export const CloseReason = Schema.Literals(["not_planned", "duplicate"]);
export type CloseReason = typeof CloseReason.Type;

export class Issues extends Context.Service<
	Issues,
	{
		// ------------------------------------------------ reads: is a write out there already?
		/** A comment on `issue` carries this key's marker. */
		readonly hasComment: (issue: string, key: string) => Effect.Effect<boolean, Failed>;
		/** The labels on `issue`. */
		readonly labels: (issue: string) => Effect.Effect<readonly string[], Failed>;
		/** `issue` is closed. */
		readonly closed: (issue: string) => Effect.Effect<boolean, Failed>;

		// ------------------------------------------------ writes: each one takes a key
		/** One comment on `issue`. Its body carries the key's marker. */
		readonly comment: (
			key: Key,
			issue: string,
			body: string,
		) => Effect.Effect<void, Failed | KeyRefused>;
		readonly label: (
			key: Key,
			issue: string,
			label: string,
		) => Effect.Effect<void, Failed | KeyRefused>;
		readonly close: (
			key: Key,
			issue: string,
			reason: CloseReason,
		) => Effect.Effect<void, Failed | KeyRefused>;
	}
>()("@kampus/fabrika-old/pipeline/Issues") {}

const ok = (exited: {readonly code: number; readonly out: string}): Effect.Effect<string, Failed> =>
	exited.code === 0 ? Effect.succeed(exited.out) : failed;

const Comments = Schema.Array(Schema.Struct({body: Schema.String}));
const IssueRead = Schema.Struct({
	state: Schema.Literals(["open", "closed"]),
	labels: Schema.Array(Schema.Struct({name: Schema.String})),
});

/**
 * `Issues` on GitHub: gh on this machine, with the host's short environment. `repos`: the only
 * repositories it may write to (`owner/name`); a write anywhere else is refused before anything is
 * sent. A close as a duplicate that GitHub does not take is sent again as not planned.
 */
export const gitHubIssues = (repos: readonly string[]): Layer.Layer<Issues> =>
	Layer.effect(
		Issues,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const env = {...hostEnv(), GIT_TERMINAL_PROMPT: "0"};
			const gh: Gh = (args) =>
				runChild("gh", args, {env}).pipe(
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.mapError((): Failed => ({_tag: "unknown"})),
					Effect.flatMap(ok),
				);
			/** The issue's REST path, for an issue in an allowed repository. */
			const pathOf = (issue: string) => {
				const at = ticketOf(issue);
				return at === null || !repos.includes(`${at.owner}/${at.name}`)
					? null
					: `repos/${at.owner}/${at.name}/issues/${at.number}`;
			};
			const readIssue = (issue: string) => {
				const path = pathOf(issue);
				return path === null ? failed : answerOf(gh, IssueRead, ["api", path]);
			};
			/** A write: the key first, then the issue's path, then the call. */
			const write = (
				key: Key,
				issue: string,
				call: (path: string, text: string) => Effect.Effect<unknown, Failed>,
			) =>
				Effect.gen(function* () {
					const text = yield* useKey(key);
					const path = pathOf(issue);
					if (path === null) return yield* failed;
					yield* call(path, text);
				});
			return Issues.of({
				hasComment: (issue, key) =>
					Effect.gen(function* () {
						const path = pathOf(issue);
						if (path === null) return yield* failed;
						// The first hundred comments: a sort's comment is among an issue's first few.
						const there = yield* answerOf(gh, Comments, ["api", `${path}/comments?per_page=100`]);
						return there.some((c) => c.body.includes(markerOf(key)));
					}),
				labels: (issue) => readIssue(issue).pipe(Effect.map((i) => i.labels.map((l) => l.name))),
				closed: (issue) => readIssue(issue).pipe(Effect.map((i) => i.state === "closed")),
				comment: (key, issue, body) =>
					write(key, issue, (path, text) =>
						gh(["api", "--method", "POST", `${path}/comments`, "-f", `body=${marked(body, text)}`]),
					),
				label: (key, issue, label) =>
					write(key, issue, (path) =>
						gh(["api", "--method", "POST", `${path}/labels`, "-f", `labels[]=${label}`]),
					),
				close: (key, issue, reason) =>
					write(key, issue, (path) => {
						const closeAs = (why: CloseReason) =>
							gh([
								"api",
								"--method",
								"PATCH",
								path,
								"-f",
								"state=closed",
								"-f",
								`state_reason=${why}`,
							]);
						return reason === "duplicate"
							? closeAs("duplicate").pipe(Effect.catch(() => closeAs("not_planned")))
							: closeAs(reason);
					}),
			});
		}),
	).pipe(Layer.provide(nodeServices));
