import {planOf, readTicketId, taskId, ticketOf} from "../ids.ts";
import {numbered} from "../stages/plan/ids.ts";
import {revisionOfDraft} from "../stages/plan/plan.ts";
import {changed, numberOf, plans86b, RULINGS} from "./cases.ts";
import type {Fact} from "./ledger.ts";
import {planAskId} from "./rules.ts";

// A demo ledger: the real cases of experiment 89 (./cases.ts) as facts, for a
// host to start the core on when there is no real run to show. It is a
// ledger of its own, made fresh each time, and never written into a real one.
//
//   the six plans experiment 86b wrote, each waiting for approval;
//   565 approved, then changed after its approval: version 2 waits, shown as what changed;
//   367 approved, and its task t1 reviewed 4, 3, 3, 3 open: stuck, no progress;
//   the four tickets experiment 88's sort sent to a ruling.
//
// Ten asks wait on the owner when the core folds it.

/** The plan the demo changes after its approval, and the one whose task gets stuck. */
const CHANGED = "565";
const STUCK = "367";

/** The demo's facts, in the order a run would have written them. */
export function demoFacts(): readonly Fact[] {
	const plans = plans86b().flatMap((p) => {
		const ticket = readTicketId(p.ticket);
		const data = p.plan === null ? null : revisionOfDraft(p.plan);
		return ticket === null || data === null ? [] : [{n: numberOf(p.ticket), ticket, data, p}];
	});
	const planned: Fact[] = plans.map(({ticket, data, p}) => ({
		type: "planned",
		plan: planOf(ticket),
		tickets: [ticket],
		data,
		problems: p.outcome.kind === "stuck" ? p.problems : [],
	}));
	const approved = (n: string): Fact[] =>
		plans
			.filter((p) => p.n === n)
			.map(({ticket}) => ({
				type: "answered",
				id: planAskId(planOf(ticket), 1),
				answer: {kind: "approve"},
			}));
	// The code that writes version 2 holds the approved version, ids and all.
	const revised: Fact[] = plans
		.filter((p) => p.n === CHANGED)
		.map(({ticket, data}) => ({
			type: "planned",
			plan: planOf(ticket),
			tickets: [ticketOf(planOf(ticket))],
			data: changed(numbered(data)),
			problems: [],
		}));
	const reviewed: Fact[] = plans
		.filter((p) => p.n === STUCK)
		.flatMap(({ticket}) =>
			[4, 3, 3, 3].map(
				(open): Fact => ({type: "reviewed", plan: planOf(ticket), task: taskId("t1"), open}),
			),
		);
	const rulings: Fact[] = RULINGS.map(({ruling}) => ({type: "ruling_needed", ...ruling}));
	return [
		...planned,
		...approved(CHANGED),
		...revised,
		...approved(STUCK),
		...reviewed,
		...rulings,
	];
}

/** The demo's facts as ledger entries, numbered from 1: what `memoryLedger` starts from. */
