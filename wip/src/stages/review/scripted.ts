import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {Effect, Layer} from "effect";
import {codeHostOn, type Gh} from "../../code-host-github.ts";
import {criterionId} from "../../criteria/book.ts";
import {CodeHost} from "../../services.ts";
import {type Brief, reviewGate} from "./gate.ts";
import type {Pack} from "./pack.ts";
import {type Drafted, Reviewer, reviewStream} from "./reviewer.ts";
import type {Heard, Note} from "./tools.ts";

// What the review stage's tests stand on: a `gh` that answers from recorded
// text, and a reviewer that answers from a script. No call leaves this file.
//
// The files under `fixtures/review/` were recorded from one real public pull
// request at two of its commits, and from the ticket it closes:
//
//   first   its first reviewed head: the one required check is red there
//   final   the head that merged: the check is green
//
// They were trimmed. The repo's name is replaced, the config file is cut to
// the one key that is read, and the pull request's text is cut to its
// opening, its closing line and two of its deviations. The diffs and the
// ticket's text are whole. The pull request reads `MERGED` in both, because
// that is what it is today: a replay of an older head cannot read the state
// it had then.
//
// `fixtures/review/rubrics/` is made up for the tests. It is not a copy of
// any real rubric.

export const PR = "https://github.com/example/repo/pull/628";
export const HEADS = {
	first: "6f4907a3ca552cf482652dd0f01b3aea3aa0853f",
	final: "b695a2af332423e6e7840236c65d31e670cb5947",
} as const;
export const BASE = "6780a06ec56372cd3a073c7d8f5eb8d34c98959c";
export type Which = keyof typeof HEADS;

export const recorded = (name: string): string =>
	readFileSync(new URL(`../../../../fixtures/review/${name}`, import.meta.url), "utf8");
/** The made-up rubric folder. It has `code.md` and `doc.md`, and no `skill.md`. */
export const RUBRICS = fileURLToPath(
	new URL("../../../../fixtures/review/rubrics/", import.meta.url),
);

const asTicket = (body: string) => JSON.stringify({data: {repository: {issue: {body}}}});

/** A recorded answer with something changed. `repo` is the answer's `repository`. */
export function changed(text: string, change: (repo: Record<string, any>) => void): string {
	const answer = JSON.parse(text);
	change(answer.data.repository);
	return JSON.stringify(answer);
}

/** One answer per call the reader makes. Left out: the recorded one. `breaks`: the call fails. */
export interface Answers {
	/** The pull request's head now, for the first call. */
	readonly now?: string | "breaks";
	readonly change?: string | "breaks";
	readonly ticket?: string | "breaks";
	readonly files?: string | "breaks";
	readonly diff?: string | "breaks";
}

/** A `gh` that answers the reader's five calls from recorded text, and keeps the calls. */
export function recordedGh(which: Which, answers: Answers = {}) {
	const calls: (readonly string[])[] = [];
	const say = (answer: string) =>
		answer === "breaks" ? Effect.fail({_tag: "unknown" as const}) : Effect.succeed(answer);
	const gh: Gh = (args) => {
		calls.push(args);
		const query = args.find((arg) => arg.startsWith("query=")) ?? "";
		if (query.includes("statusCheckRollup"))
			return say(answers.change ?? recorded(`change-${which}.json`));
		if (query.includes("issue(number"))
			return say(answers.ticket ?? asTicket(recorded("tickets/625.md")));
		if (query !== "") {
			const now = answers.now ?? HEADS.final;
			return say(
				now === "breaks"
					? now
					: JSON.stringify({
							data: {repository: {pullRequest: {headRefOid: now, baseRefName: "main"}}},
						}),
			);
		}
		return args.includes("Accept: application/vnd.github.diff")
			? say(answers.diff ?? recorded(`compare-${which}.diff`))
			: say(answers.files ?? recorded(`compare-${which}.json`));
	};
	return {gh, calls};
}

/** `CodeHost` over a recorded `gh`. The accounts are the ship stage's; a review reads none. */
export const recordedHost = (gh: Gh) =>
	Layer.succeed(CodeHost, codeHostOn(gh, {own: [], reviewers: []}));

/** A small pack with nothing missing, written by hand: two criteria, a code file and a doc. */
export const WHOLE: Pack = {
	pr: "https://github.com/example/repo/pull/7",
	head: "a".repeat(40),
	replay: false,
	state: "open",
	ticket: {id: "example/repo#3", link: "closes_it"},
	criteria: [
		{id: criterionId("c1"), version: 1, text: "it works", checked: false, evidence: null},
		{id: criterionId("c2"), version: 1, text: "it is written down", checked: false, evidence: null},
	],
	files: [
		{path: "src/a.ts", kind: "review-code"},
		{path: "docs/a.md", kind: "review-doc"},
	],
	kinds: ["review-code", "review-doc"],
	diff: "diff --git a/src/a.ts b/src/a.ts\n",
	deviations: {state: "none"},
	checks: {state: "green", required: [{name: "build", state: "green"}]},
	rules: [],
	rubrics: [
		{kind: "review-code", text: "the code rubric"},
		{kind: "review-doc", text: "the doc rubric"},
	],
};

/** The brief the gate makes of a pack. It throws on a pack the gate stops: a test that asks for a brief means one that goes. */
export function briefOf(pack: Pack): Brief {
	const gate = reviewGate(pack);
	if (gate.answer !== "go") throw new Error("the gate did not let this pack through");
	return gate.brief;
}

/** What a scripted reviewer does besides its answer. */
export interface Script {
	/** The notes it files, in order, through the same doors a live run has. */
	readonly notes?: (brief: Brief) => readonly Note[];
	/** Done before it answers, after its notes: a test holds the run open with it. */
	readonly hold?: Effect.Effect<void>;
}

/**
 * A reviewer that answers from a script, and keeps each brief it was handed
 * and what each of its doors heard back. It runs through `reviewStream`, the
 * live reviewer's own: only the agent is scripted.
 */
export function scriptedReviewer(
	/** `run`: which run of this reviewer it is, from 1. */
	answer: (brief: Brief, run: number) => Drafted,
	script: Script = {},
) {
	const briefs: Brief[] = [];
	/** What each run was told about the try before it: `null` on a first try. */
	const told: (string | null)[] = [];
	const heard: Heard[] = [];
	const layer = Layer.succeed(Reviewer, {
		review: (brief, _settings, note) =>
			reviewStream((tools) =>
				Effect.gen(function* () {
					briefs.push(brief);
					told.push(note);
					for (const note of script.notes?.(brief) ?? []) heard.push(yield* tools.file_note(note));
					yield* script.hold ?? Effect.void;
					return answer(brief, briefs.length);
				}),
			),
	});
	return {layer, briefs, told, heard};
}
