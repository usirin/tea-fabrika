// Experiment 111's world, as a host process sees it: the sort stage's reads and `Issues` over the
// fake issue host (./fake-issues.ts, in the harness process), and a scripted sorter. As in 104, the
// scripted sorter takes 300 ms and bills $0.10 a try, so a kill 100 ms into a turn lands inside it,
// and a wasted turn shows on the ledger's bill.
//
// The cases, each a ticket of `example/repo`:
//
//   #20 duplicate   the same bug as open #1, reworded. Comment, label, close as a duplicate
//   #21 no          a standing readout: not a work item. Comment, label, close as not planned
//   #22 fold        a case the open plan for #8 missed. Its first try names a plan that is not
//                   open (#99), so the Check sends it back; the second names #8. Comment, label,
//                   and a link comment on #8
//   #23 ruling      an owner must choose. Comment, label, and a `ruling_needed` fact on the ledger
import {Duration, Effect, Layer, Schema, Stream} from "effect";
import type {DraftRun, Spend} from "../../packages/fabrika/src/agents/claude/draft.ts";
import {type Key, useKey} from "../../packages/pipeline/src/hosted/idempotency.ts";
import {Issues} from "../../packages/pipeline/src/hosted/issues.ts";
import {marked} from "../../packages/pipeline/src/hosted/outside.ts";
import type {PlanDraft} from "../../packages/pipeline/src/stages/plan/plan.ts";
import type {SortAnswer} from "../../packages/pipeline/src/stages/sort/answer.ts";
import {
	type Earlier,
	reasonIn,
	Sorter,
	SortHost,
	type SortMsg,
	type SortTicket,
} from "../../packages/pipeline/src/stages/sort/services.ts";
import {issueUrl, type Seed} from "./fake-issues.ts";

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** What one scripted try bills. */
export const TURN_USD = 0.1;
const TURN = Duration.millis(300);
const spendOf = (usd: number): Spend => ({
	costUsd: usd,
	tokens: 100,
	context: 50,
	turns: 1,
	minutes: 0.01,
});

// ---------------------------------------------------------------- the repo and the cases

const SORT_DONE = (key: string) => `<!-- fabrika-key: ${key} -->`;

/** The issues every run starts with, besides the case's own ticket. */
export const BACKGROUND: readonly Seed[] = [
	{
		number: 1,
		title: "Widgets render twice when the window is resized",
		body: "Resize the browser window: every widget on the page draws two times, one over the other.",
	},
	{
		number: 2,
		title: "Add a dark theme",
		body: "A dark theme for the widgets.",
		state: "closed",
		comments: [
			`No: won't do: already ruled out; reopen only with a new fact\n\nThe owner ruled out themes for now.\n\n${SORT_DONE("sort:2#comment:https://github.com/example/repo/issues/2")}`,
		],
	},
	{
		number: 8,
		title: "Resize handling, end to end",
		body: "Widgets should keep their size and place when the window is resized.",
	},
];

export type Case = "duplicate" | "no" | "fold" | "ruling";
export const CASES: Record<Case, Seed> = {
	duplicate: {
		number: 20,
		title: "Each widget is drawn two times after a resize",
		body: "When I make the window smaller, all the widgets show up twice.",
	},
	no: {
		number: 21,
		title: "Weekly widget download numbers",
		body: "A standing page where the bot posts the download count each week. Nothing to change.",
	},
	fold: {
		number: 22,
		title: "A resize to zero width loses the widgets' place",
		body: "Resize the window to zero width and back: the widgets come back at the top left.",
	},
	ruling: {
		number: 23,
		title: "Should widgets keep a bundled copy of their font?",
		body: "Bundling the font makes the package 400 KB bigger; not bundling it means a network fetch.",
	},
};
export const caseOf = (number: number): Case | null =>
	(Object.entries(CASES).find(([, s]) => s.number === number)?.[0] as Case | undefined) ?? null;

/** The plan for #8, as the `planned` fact the harness seeds for the fold case. */
export const PLAN_8: PlanDraft = {
	summary: "Widgets lose their size and place when the window is resized.",
	stories: [{id: "s1", who: "a page author", want: "widgets that stay put", why: "pages hold"}],
	tasks: [
		{
			title: "Keep each widget's place across a resize",
			ends: "pr",
			job: {
				when: "someone resizes a page with ten widgets three times",
				result: "every widget keeps its size and place",
				fixture: "a page with ten widgets, resized three times",
				check: {how: "test", what: "a test resizes the page and reads every widget's box"},
				serves: ["s1"],
			},
			criteria: [],
		},
	],
	pointers: [],
	questions: [],
};

/** The scripted answer to one try of one case. */
const scriptFor = (c: Case, tries: number): SortAnswer => {
	switch (c) {
		case "duplicate":
			return {answer: "duplicate", of: 1, why: "Both report widgets drawn twice on a resize."};
		case "no":
			return {
				answer: "no",
				rule: "not_work",
				reason: "won't do: not a work item",
				why: "It is a standing readout and asks for no change.",
			};
		case "fold":
			return {
				answer: "yes",
				next: "plan",
				partOf: tries === 1 ? 99 : 8,
				why: "A resize case the resize plan does not cover yet.",
			};
		case "ruling":
			return {
				answer: "yes",
				next: "ruling",
				ask: "Bundle the font, or fetch it?",
				options: ["Bundle it", "Fetch it"],
				why: "A size against a network trade-off is the owner's call.",
			};
	}
};

const triesOf = (run: DraftRun) => Number(run.id.slice(run.id.lastIndexOf("/") + 1));
const numberOfName = (key: string) => Number(key.slice(key.lastIndexOf(":") + 1));

/** The scripted sorter: 300 ms, $0.10 a try, the case's answer. */
export const scriptedSorter = Layer.succeed(Sorter, {
	run: (run) =>
		Stream.fromEffect(
			Effect.gen(function* () {
				yield* Effect.sleep(TURN);
				const c = caseOf(numberOfName(run.key));
				if (c === null) return yield* Effect.die(`no case for ${run.key}`);
				return {
					type: "sort_finished",
					key: run.key,
					id: run.id,
					output: {sort: scriptFor(c, triesOf(run))},
					session: "s",
					spend: spendOf(TURN_USD),
				} satisfies SortMsg;
			}),
		),
});

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
const send = (fake: string, fn: string, key: Key, args: Record<string, unknown>) =>
	useKey(key).pipe(
		Effect.flatMap((text) => call(fake, {fn, args, key: text, name: key.name, fence: key.fence})),
	);
/** The planted mistake: a write sent to the issue host with no key at all. */
export const rawWrite = (fake: string, fn: string, args: Record<string, unknown>) =>
	call(fake, {fn, args});

const as =
	<A>(schema: Schema.Codec<A, unknown>) =>
	(u: unknown) =>
		Schema.decodeUnknownEffect(schema)(u).pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));
const IssueRead = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	body: Schema.String,
	state: Schema.Literals(["open", "closed"]),
});
const ListRead = Schema.Array(
	Schema.Struct({
		number: Schema.Int,
		title: Schema.String,
		state: Schema.Literals(["open", "closed"]),
		comments: Schema.Array(Schema.String),
	}),
);
const Ok = Schema.Struct({ok: Schema.Boolean});
const okOrFail = (u: unknown) =>
	as(Ok)(u).pipe(Effect.flatMap((o) => (o.ok ? Effect.void : failed)));

/** The sort stage's reads over the fake. */
export const fakeSortHost = (fake: string) =>
	Layer.succeed(SortHost, {
		ticket: (url) =>
			read(fake, "issue", {issue: url}).pipe(
				Effect.flatMap(as(IssueRead)),
				Effect.map((i): SortTicket => ({url, ...i})),
			),
		earlier: (ticket) =>
			read(fake, "list", {}).pipe(
				Effect.flatMap(as(ListRead)),
				Effect.map((all) =>
					all
						.filter((i) => i.number !== ticket.number)
						.map(
							(i): Earlier => ({
								number: i.number,
								title: i.title,
								state: i.state,
								reason: i.state === "open" ? null : reasonIn(i.comments),
							}),
						),
				),
			),
	});

/** `Issues` over the fake. */
export const fakeIssues = (fake: string) =>
	Layer.succeed(
		Issues,
		Issues.of({
			hasComment: (issue, key) =>
				read(fake, "hasComment", {issue, key}).pipe(Effect.map((b) => b === true)),
			labels: (issue) =>
				read(fake, "labels", {issue}).pipe(Effect.flatMap(as(Schema.Array(Schema.String)))),
			closed: (issue) => read(fake, "closed", {issue}).pipe(Effect.flatMap(as(Schema.Boolean))),
			comment: (key, issue, body) =>
				useKey(key).pipe(
					Effect.flatMap((text) => send(fake, "comment", key, {issue, body: marked(body, text)})),
					Effect.flatMap(okOrFail),
				),
			label: (key, issue, label) =>
				send(fake, "label", key, {issue, label}).pipe(Effect.flatMap(okOrFail)),
			close: (key, issue, reason) =>
				send(fake, "close", key, {issue, reason}).pipe(Effect.flatMap(okOrFail)),
		}),
	);

export {issueUrl};
