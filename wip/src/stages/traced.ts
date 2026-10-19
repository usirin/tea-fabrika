import type {Machine} from "@demlik/tea";
import {ATTR, type Drawing, type Tags} from "@tea-fabrika/tea-program/trace";
import type {build} from "./build/machine.ts";
import type {loop} from "./operate/machine.ts";
import {nameOf} from "./outcome.ts";
import {problemsOf, type review} from "./review/machine.ts";
import type {ship} from "./ship/machine.ts";

// How each stage's machine is drawn in a trace (../program/trace.ts): its
// span's name, a plain name for each step, and the tags read from its state.
// The stage is the service, so a viewer gives build, review and ship each its
// own color, and a step's name reads after it: "review  waiting on checks".
//
// Tags are ids and counts: a ticket's or a pull request's url, a round, a
// commit's first seven characters, an outcome's name, dollars. A url is an
// address anyone can read; nothing of a ticket's or a pull request's text is
// ever put on a span. One tag is words: a review's problems (`tea.problems`),
// code's own sentences about the reviewer's form, so a refused form says why
// on the span.

/** The drawing of one machine, from its type. */
type DrawingOf<T> =
	T extends Machine<infer S, infer _M, infer C, infer U, infer _Ctx> ? Drawing<S, C, U> : never;

/** A GitHub issue's or pull request's url, as `#123`. Anything else: `null`. */
export const refOf = (url: string): string | null => {
	const found = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:pull|issues)\/(\d+)/.exec(url);
	return found === null ? null : `#${found[1]}`;
};

/** How a run alone on one pull request is named: `pr #597`. */
export const prName = (pr: string): string => `pr ${refOf(pr) ?? ""}`.trim();

/** The attributes of a span about one pull request. A url that is not one gives none. */
export const prAttributes = (url: string): Readonly<Record<string, string>> => {
	const found = /^(https:\/\/github\.com\/[^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(url);
	if (found === null) return {};
	const [, repo = "", number = ""] = found;
	return {"vcs.repository.url.full": repo, "vcs.change.id": number, [ATTR.pr]: url};
};

/** A commit, short, as people say it. */
const short = (head: string | null | undefined): Tags =>
	head === null || head === undefined ? {} : {[ATTR.head]: head.slice(0, 7)};

/** Dollars, when something was spent. */
const cost = (usd: number | undefined): Tags =>
	usd === undefined ? {} : {[ATTR.costUsd]: Math.round(usd * 10_000) / 10_000};

/** One build round: the ticket, then the builder, then the push and the pull request. */
export const buildDrawing = (ticket: string, round: number): DrawingOf<typeof build> => ({
	name: `round ${round}`,
	service: "build",
	attributes: {[ATTR.ticket]: ticket, [ATTR.round]: round},
	steps: {
		build_ticket: "read ticket",
		build_copy: "copy working tree",
		build_run: "builder",
		build_push: "push branch",
		build_open: "open pull request",
	},
	tags: (s) =>
		s.phase !== "over"
			? {}
			: {
					[ATTR.outcome]: nameOf(s.outcome),
					...(s.report.pr === null ? {} : {[ATTR.pr]: s.report.pr}),
					...short(s.report.head),
					...cost(s.report.ran?.spend.costUsd),
					...(s.report.problems.length === 0
						? {}
						: {[ATTR.problems]: s.report.problems.join("\n")}),
				},
});

/**
 * One review of a pull request. `name`: `round 2` inside a ticket's loop,
 * the pull request's number when it runs alone.
 */
export const reviewDrawing = (name: string, pr: string): DrawingOf<typeof review> => ({
	name,
	service: "review",
	attributes: prAttributes(pr),
	steps: {
		review_pack: "read pull request",
		review_checks: "waiting on checks",
		review_run: "reviewer",
		review_file_note: "keep note",
	},
	tags: (s) => {
		switch (s.phase) {
			case "waiting":
				return short(s.head);
			case "over": {
				const problems = problemsOf(s.report);
				return {
					[ATTR.outcome]: nameOf(s.outcome),
					...short(s.report.head),
					...cost(s.report.runs === 0 ? undefined : s.report.cost),
					...(problems.length === 0 ? {} : {[ATTR.problems]: problems.join("\n")}),
				};
			}
			default:
				return {};
		}
	},
});

/** One ship of a pull request, named as `reviewDrawing` names a review. */
export const shipDrawing = (name: string, pr: string): DrawingOf<typeof ship> => ({
	name,
	service: "ship",
	attributes: prAttributes(pr),
	steps: {
		ship_facts: "read pull request",
		ship_checks: "waiting on checks",
		ship_rerun_checks: "re-run checks",
		ship_enqueue: "add to merge queue",
		ship_merge: "merge",
		ship_queue: "waiting on merge queue",
		ship_finish: "tidy up",
	},
	tags: (s) => {
		switch (s.phase) {
			case "waiting":
			case "rerunning":
				return short(s.head);
			// Past the gate, the head is the one the proof names.
			case "enqueueing":
			case "merging":
			case "queued":
				return short(s.ready.head);
			case "over":
				return {[ATTR.outcome]: nameOf(s.outcome)};
			default:
				return {};
		}
	},
});

/**
 * One ticket's loop. Its build, review and ship rounds are drawn by their own
 * machines, right under it; only posting the verdicts is a step of its own.
 */
export const loopDrawing = (ticket: string): DrawingOf<typeof loop> => ({
	name: `ticket ${refOf(ticket) ?? ""}`.trim(),
	attributes: {[ATTR.ticket]: ticket},
	steps: {loop_build: null, loop_review: null, loop_post: "post verdicts", loop_ship: null},
	tags: (s) => {
		if (s.phase === "idle") return {};
		const spent = s.rounds.reduce((sum, round) => sum + round.spend, 0);
		const pr = s.phase === "over" ? s.rounds.at(-1)?.pr : "pr" in s ? s.pr : undefined;
		return {
			...(s.phase === "over" ? {[ATTR.outcome]: nameOf(s.outcome)} : {[ATTR.round]: s.round}),
			...(pr === undefined || pr === null ? {} : {[ATTR.pr]: pr}),
			...cost(spent),
		};
	},
});
