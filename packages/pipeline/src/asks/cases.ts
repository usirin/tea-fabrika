import {readFileSync} from "node:fs";
import {Schema} from "effect";
import {storyId, ticketId} from "../ids.ts";
import {revisionOf} from "../stages/plan/ids.ts";
import type {Plan, Revision} from "../stages/plan/plan.ts";
import {Planned} from "../stages/plan/program.ts";
import type {Ruling} from "./program.ts";

// Realistic cases for the owner's asks, for tests (experiment 89):
//
//   the six plans experiment 86b wrote for closed demlik tickets, as the plan
//   stage handed them back (`experiments/results/86b-plans.json`);
//   one of them changed after its approval, the way a new report that fits an
//   approved plan changes it;
//   four tickets experiment 88's sort sent to a ruling, with what really
//   happened to each, read from their history (`experiments/88-truth.json`).

const PLANS = new URL("../../../../experiments/results/86b-plans.json", import.meta.url);

/** The six 86b plans, in ticket order, each as the plan program's `planned` output. */
export function plans86b(): readonly Planned[] {
	const saved: Record<string, unknown> = JSON.parse(readFileSync(PLANS, "utf8"));
	return Object.values(saved).map((value) => Schema.decodeUnknownSync(Planned)(value));
}

/** The ticket number at the end of a url, or of a ticket's name (`owner/repo#N`). */
export const numberOf = (url: string): string => url.split(/[/#]/).at(-1) ?? url;

/**
 * Plan 565, changed after it was approved: its open question is settled with
 * its lean, its first single criterion is said more tightly, and one new
 * criterion comes from a new report that fits the plan. Everything else is as
 * it was. Written from the approved plan, so every criterion it keeps names
 * its id; the new one has none, and gets the next.
 */
export function changed(approved: Plan): Revision {
	const plan = revisionOf(approved);
	const [task, ...rest] = plan.tasks;
	if (task === undefined) return plan;
	const [first, ...others] = task.criteria;
	const tightened =
		first === undefined
			? []
			: [
					{
						...first,
						result: `${first.result}, and the run's report lists no B8 for either of them`,
					},
				];
	return {
		...plan,
		tasks: [
			{
				...task,
				criteria: [
					...tightened,
					...others,
					{
						when: "a scope leaves decidedBy out and also lists no allowed libraries",
						result: "the check refuses the file and names the scope, the same as an empty list",
						check: {how: "test", what: "a test over a fixture with such a scope"},
						serves: first?.serves ?? [storyId("s1")],
					},
				],
			},
			...rest,
		],
		questions: [],
	};
}

/** What really happened to a ruling, as the answer's branch. */
export interface Truth {
	readonly rule: "lasting" | "one_off";
	readonly build: boolean;
	readonly said: string;
}

const DEMLIK = (n: number) => ticketId(`https://github.com/kamp-us/demlik/issues/${n}`);

/** Four tickets experiment 88's sort sent to a ruling, worded from the ticket, with what really happened. */
export const RULINGS: readonly {readonly ruling: Ruling; readonly truth: Truth}[] = [
	{
		ruling: {
			ticket: DEMLIK(68),
			ask: "driveToDone hangs when the machine settles in a state that is not terminal. What should it do?",
			options: [
				"(a) document the hang",
				"(b) reject when no Subs are active",
				"(c) add a deadline",
			],
			why: "It names three options with different trade-offs, and an owner has to choose the contract before a builder implements it.",
		},
		truth: {rule: "one_off", build: true, said: "(b): reject when no Subs are active."},
	},
	{
		ruling: {
			ticket: DEMLIK(163),
			ask: "toolConcurrency runs tools one after another. Make it real parallelism, or say it is only a dispatch knob?",
			options: ["real parallelism", "document it as dispatch-only"],
			why: "Parallelism changes the kernel's Cmd ordering and error semantics: a direction call for the owners.",
		},
		truth: {rule: "lasting", build: false, said: "Document it as a dispatch-only knob."},
	},
	{
		ruling: {
			ticket: DEMLIK(182),
			ask: "Rename the R type parameter to Deps, or keep R?",
			options: ["rename R to Deps", "keep R"],
			why: "A naming decision the ticket says is the owners' to make.",
		},
		truth: {rule: "one_off", build: false, said: "Keep R."},
	},
	{
		ruling: {
			ticket: DEMLIK(640),
			ask: "stop() waits on the queue with no limit. Is the unbounded wait intended, or should it be bounded?",
			options: ["document the unbounded wait", "add a bound such as disposeTimeoutMs"],
			why: "The contract is unsettled, and a builder should not pick it.",
		},
		truth: {rule: "lasting", build: true, said: "Add a bound: disposeTimeoutMs."},
	},
];
