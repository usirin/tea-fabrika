// Experiment 112's pairs and books, shared by the runner (../112-reviewer-noise.ts) and the count
// (./count.ts). A pair is a commit 105b left and the book as it stood when the lane reviewed it,
// rebuilt from the facts the lane had written by then (./inputs.json, made by ./extract.ts).
//
// Node at the edge: inputs.json is read with readFileSync.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {Exit, Schema} from "effect";
import type {Fact} from "../../packages/pipeline/src/asks/ledger.ts";
import {bookTarget, taskTarget} from "../../packages/pipeline/src/code-host-local.ts";
import {
	type Owner,
	PLAN,
	planOf,
	type TaskId,
	taskId,
	ticketId,
	ticketOf,
} from "../../packages/pipeline/src/ids.ts";
import {PlanDraft, revisionOfDraft} from "../../packages/pipeline/src/stages/plan/plan.ts";
import type {Judged, PassInput} from "./extract.ts";

export const INPUTS: Record<string, PassInput> = JSON.parse(
	readFileSync(fileURLToPath(new URL("inputs.json", import.meta.url)), "utf8"),
);

export const PLAN_ID = planOf(ticketId("example/repo#700"));

/**
 * A pair: a pass, the lane's review whose book and head are judged again (the book as it stood just
 * before that review ran), and the task.
 */
export interface Pair {
	readonly id: string;
	readonly pass: string;
	readonly before: string;
	readonly task: TaskId;
	readonly why: string;
}

export const PAIRS: readonly Pair[] = [
	{
		id: "p2-t2-f590",
		pass: "pass2",
		before: "lane:700:t2:r5:review",
		task: taskId("t2"),
		why: "the c6 case: the task review passed c6, the last review failed it, same commit",
	},
	{
		id: "p3-t2-9698",
		pass: "pass3",
		before: "lane:700:t2:r8:review",
		task: taskId("t2"),
		why: "c5, the whole job on one task: failed in 9 reviews of 9; here the only one open",
	},
	{
		id: "p3-t1-5148",
		pass: "pass3",
		before: "lane:700:t1:r4:review",
		task: taskId("t1"),
		why: "judged twice by the lane: c1 and c2 failed, then passed, same commit",
	},
	{
		id: "p4-t2-23bb",
		pass: "pass4",
		before: "lane:700:t2:r2:review",
		task: taskId("t2"),
		why: "the task review failed c13 (review-added); the last review failed c1 and c10",
	},
	{
		id: "p4-t1-741c",
		pass: "pass4",
		before: "lane:700:t1:r7:review",
		task: taskId("t1"),
		why: "the last review failed 8, 5 of them passed by their task's own review",
	},
	{
		id: "p1-t2-fb61",
		pass: "pass1",
		before: "lane:700:t2:r7:review",
		task: taskId("t2"),
		why: "judged three times by the lane at one commit: unseen, a finding, a fail",
	},
];

/** The task or `plan` a lane review's child name is for: `lane:700:t2:r5:review`, `lane:700:final:r1:review`. */
export const ownerOf = (name: string): Owner => {
	const part = name.split(":")[2] ?? "";
	return part === "final" ? PLAN : taskId(part);
};

/** The facts of a pass up to its review number `at`: the plan, then each earlier review's round. */
export const factsUpTo = (pass: string, at: number): Fact[] => {
	const input = INPUTS[pass];
	if (input === undefined) throw new Error(`no inputs for ${pass}`);
	const drafted = Schema.decodeUnknownExit(PlanDraft)(input.draft);
	const data = Exit.isSuccess(drafted) ? revisionOfDraft(drafted.value) : null;
	if (data === null) throw new Error(`${pass}: the plan does not read`);
	const facts: Fact[] = [
		{type: "planned", plan: PLAN_ID, tickets: [ticketOf(PLAN_ID)], data, problems: []},
	];
	for (const r of input.reviews.slice(0, at)) {
		// As the lane: a review with no row keeps no round (stages/review/program.ts, `judgementOf`).
		if (r.rows.length === 0) continue;
		const task = ownerOf(r.name);
		const proof = `the review of ${task === PLAN ? bookTarget(PLAN_ID) : taskTarget(PLAN_ID, task)} at ${r.head}`;
		facts.push({
			type: "judged",
			plan: PLAN_ID,
			task,
			head: r.head,
			proof,
			rows: r.rows.map((row) => ({...row, head: r.head, proof})),
			found: r.found,
		} as Fact);
	}
	return facts;
};

/** The facts the lane had written when the pair's review started, its head, and what the lane said there. */
export const factsFor = (pair: Pair): {facts: Fact[]; head: string; lane: Judged[]} => {
	const reviews = INPUTS[pair.pass]?.reviews ?? [];
	const at = reviews.findIndex((r) => r.name === pair.before);
	const target = reviews[at];
	if (target === undefined) throw new Error(`${pair.pass}: no review ${pair.before}`);
	// What the lane itself said at this head: every review of it, the one asked about and after.
	return {
		facts: factsUpTo(pair.pass, at),
		head: target.head,
		lane: reviews.filter((r) => r.head === target.head),
	};
};

/** A grade as the results keep it: `none` is unseen, no row, or no form at all. */
export type Grade = "pass" | "fail" | "none";

/** One run, as the results keep it. */
export interface Ran {
	readonly pair: string;
	readonly model: string;
	readonly as: "task" | "last";
	readonly k: number;
	readonly ended: string;
	readonly head: string | null;
	readonly cost: number;
	readonly runs: number;
	readonly ms: number;
	/** Each criterion the review was given, by id. */
	readonly grades: Record<string, Grade>;
	/** Findings on a criterion of the book: they hold that row open. */
	readonly onCriteria: readonly {id: string; fault: string; wants: string}[];
	/** Findings no criterion covers: each would become a new criterion of the book. */
	readonly found: readonly Found[];
	readonly problems: readonly string[];
}

export interface Found {
	readonly from: {readonly source: string} & Record<string, unknown>;
	readonly kind: string;
	readonly fault: string;
	readonly wants: string;
	readonly at: {readonly file: string; readonly first: number; readonly last: number} | null;
}
