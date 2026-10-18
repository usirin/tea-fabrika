import {join} from "node:path";
import {Layer, Schema} from "effect";
import {type Accounts, gitHubCodeHost} from "../code-host-github.ts";
import {defineProgram} from "../program/program.ts";
import {flag} from "../program/shape.ts";
import type {CodeHost} from "../services.ts";
import {liveBuilder} from "../stages/build/builder.ts";
import {gitHubBuild} from "../stages/build/github.ts";
import {buildProgram} from "../stages/build/program.ts";
import {operateProgram} from "../stages/operate/program.ts";
import {gitHubSandboxWrites} from "../stages/operate/writes.ts";
import type {Brief} from "../stages/review/gate.ts";
import {createReviewProgram, reviewProgram} from "../stages/review/program.ts";
import {liveReviewer, noRun} from "../stages/review/reviewer.ts";
import {scriptedReviewer} from "../stages/review/scripted.ts";
import type {Form} from "../stages/review/sheet.ts";
import {noWrites} from "../stages/ship/launch.ts";
import {shipProgram} from "../stages/ship/program.ts";
import {type Entry, listed} from "./programs.ts";

// fabrika's own programs, as tsh lists them: ship and review, over GitHub,
// and build and operate, which write to the sandbox (src/sandbox.ts).
//
// tsh writes to no repository but the sandbox. That is held by structure,
// not by a warning:
//
//   - its `ship` takes `--mode read` alone. `--mode write` does not fit the
//     flag's shape, so the line is refused before anything starts, like any
//     value that does not fit.
//   - it is listed with `noWrites` as its write side: a write would die.
//   - build and operate take a sandbox ticket and nothing else, and are listed
//     only with write sides that check every target against the sandbox and
//     die on any other. operate's ship writes through those, in write mode.
//
// `review-scripted` is the review program with its reviewer scripted: the
// pack is read from GitHub for real, the gate runs for real, and where the
// agent would grade, a script hands back a form that passes every criterion.
// It costs nothing and proves the wiring, not the review. `review`, with a
// live agent, is listed only when the launcher is given a clone to read code
// from.
//
//   review-scripted --rubrics fixtures/review/rubrics --model opus --effort medium --budget 1 \
//       pr=https://github.com/<o>/<r>/pull/<n> | ship --mode read

/** ship, read only: the same program, with a mode flag that takes `read` and nothing else. */
export const shipReadOnly = defineProgram({
	...shipProgram,
	description: `${shipProgram.description} In tsh it only reads: its mode takes read alone.`,
	flags: {
		mode: flag(
			Schema.Literals(["read"]),
			"read: change nothing, say what the machine would send. tsh has no write mode: it never writes to GitHub.",
		),
	},
});

/** A form that passes every criterion, worked out from the brief alone. */
const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		n: criterion.n,
		grade: "pass",
		where: [{file: brief.files[0]?.path ?? "README.md", first: 1, last: 1}],
		says: "Scripted: it does.",
		limit: null,
	})),
	findings: [],
	skipped: [{what: "Everything", why: "A scripted reviewer reads nothing."}],
});

const scripted = createReviewProgram();
/** review, with a scripted reviewer that passes every criterion. Everything else is the review program's own. */
export const reviewScripted = defineProgram({
	...scripted,
	name: "review-scripted",
	description:
		"The review program with a scripted reviewer: it reads each pull request from GitHub and runs the gate for real, then passes every criterion without reading the code. It costs nothing. It proves the wiring, not a review.",
});

export interface FabrikaSettings extends Accounts {
	/** A local clone the live reviewer reads code from. Left out: no live `review` is listed. */
	readonly clone?: string;
	/**
	 * The folder build and operate keep the sandbox's clone and working copies
	 * in. Left out: neither is listed, and tsh writes nowhere.
	 */
	readonly work?: string;
}

/**
 * build and operate: the two programs that write, and only to the sandbox.
 * Their input takes a sandbox ticket and nothing else, so a line that names
 * another repository's ticket is refused when its value is read, before
 * anything starts. Their services write to the sandbox alone (src/sandbox.ts).
 * The sandbox has no required checks, so its reader waits on every check.
 */
export function sandboxEntries(settings: Accounts & {readonly work: string}): readonly Entry[] {
	const {work} = settings;
	const reads = () =>
		gitHubCodeHost({own: settings.own, reviewers: settings.reviewers, checks: "every"});
	return [
		listed(
			buildProgram,
			Layer.suspend(() => Layer.mergeAll(gitHubBuild({work}), liveBuilder())),
		),
		listed(
			operateProgram,
			Layer.suspend(() =>
				Layer.mergeAll(
					reads(),
					gitHubBuild({work}),
					liveBuilder(),
					// The build's clone holds every commit it pushed: its working copies share its store.
					liveReviewer({repo: join(work, "clone")}),
					gitHubSandboxWrites(),
				),
			),
		),
	];
}

/**
 * ship (read only) and review-scripted, over GitHub; review with a live agent
 * when there is a clone to read; build and operate when there is a folder to
 * work in. `reads`: the GitHub reader, made fresh for each run; a test stands
 * in one over recorded answers.
 */
export function fabrikaEntries(
	settings: FabrikaSettings,
	reads: () => Layer.Layer<CodeHost> = () =>
		gitHubCodeHost({own: settings.own, reviewers: settings.reviewers}),
): readonly Entry[] {
	const host = reads;
	const reviewer = () =>
		scriptedReviewer((brief) => ({answer: "form", form: passing(brief), ...noRun})).layer;
	const entries = [
		listed(
			shipReadOnly,
			Layer.suspend(() => Layer.mergeAll(host(), noWrites)),
		),
		listed(
			reviewScripted,
			Layer.suspend(() => Layer.mergeAll(host(), reviewer())),
		),
	];
	const {clone, work} = settings;
	const live =
		clone === undefined
			? []
			: [
					listed(
						reviewProgram,
						Layer.suspend(() => Layer.mergeAll(host(), liveReviewer({repo: clone}))),
					),
				];
	const writing =
		work === undefined
			? []
			: sandboxEntries({own: settings.own, reviewers: settings.reviewers, work});
	return [...entries, ...live, ...writing];
}
