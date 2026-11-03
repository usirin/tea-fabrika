import {flag, output} from "@kampus/fabrika-old";
import {
	Answer,
	type Ask,
	Ask as AskShape,
	Refused,
	Settled,
	Waiting,
} from "@kampus/pipeline/asks/ask";
import {type Fact, readFacts, sendFact} from "@kampus/pipeline/asks/ledger";
import {
	Build,
	BuildRef,
	Built,
	Cleared,
	Raise,
	Reviewed,
	Revised,
	Ruling,
} from "@kampus/pipeline/asks/program";
import {
	type Folded,
	foldLedger,
	nextOf,
	openAsks,
	problemWith,
	readyBuilds,
} from "@kampus/pipeline/asks/rules";
import {planOf, readTicketId, ticketOf} from "@kampus/pipeline/ids";
import {revisionOfDraft} from "@kampus/pipeline/stages/plan/plan";
import {Planned} from "@kampus/pipeline/stages/plan/program";
import {Effect, Schema} from "effect";
import * as Program from "./serve.ts";

// Experiment 164's spike: the asks program (packages/pipeline/src/asks/program.ts)
// on one mailbox. The same setup and the same work per value; the eight inputs
// are served from one mailbox in the order told, in place of seven merged
// streams merged again with `answer`. `idOf` and `factOf` are copied from that
// file unchanged. A record: it was written against the runtime before
// https://github.com/usirin/tea-fabrika/pull/195, which ported the real asks
// program to the real mailbox, and it no longer runs on main.

const idOf = (fact: Fact): {readonly id?: string} => {
	switch (fact.type) {
		case "answered":
			return {id: `answered:${fact.id}`};
		case "shipped":
			return {id: `shipped:${fact.plan}/${fact.task}/${fact.build}`};
		case "cleared":
			return {id: `cleared:${fact.plan}/${fact.task}/${fact.build}:${fact.by}`};
		case "check_raised":
			return {id: `check_raised:${fact.plan}/${fact.task}/${fact.build}:${fact.by}`};
		default:
			return {};
	}
};

const factOf = (planned: Planned): Fact | null => {
	const ticket = readTicketId(planned.ticket);
	const data = planned.plan === null ? null : revisionOfDraft(planned.plan);
	return ticket === null || data === null
		? null
		: {
				type: "planned",
				plan: planOf(ticket),
				tickets: [ticket],
				data,
				problems: planned.outcome.kind === "stuck" ? planned.problems : [],
			};
};

export const spikeAsks = Program.make("asks", {
	description:
		"Keeps what waits on the owner: a plan to approve, a stuck task, a ticket to rule on, a build someone asked the owner to check. It says each new ask on `ask`, takes answers on `answer`, checks each against the open ask, and keeps the ones it takes in the ledger. It never knows who shows the asks.",
	flags: {
		holds: flag(
			Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			"How many listeners hold each build until they clear it or raise a check on it.",
			{default: 0},
		),
	},
	inputs: {
		planned: Program.input(
			Planned,
			"A plan the plan stage wrote: its owner approves it before it is built.",
		),
		revised: Program.input(
			Revised,
			"A next version of a plan, by code that holds the last one: a criterion it keeps names its id.",
		),
		reviewed: Program.input(
			Reviewed,
			"A review round of one task ended, with how many criteria it left open.",
		),
		ruling: Program.input(Ruling, "A ticket sort sent to the owner to rule on."),
		answer: Program.input(Answer, "The owner's answer to an open ask, under the ask's id."),
		build: Program.input(Build, "A build of one task finished, with the files it changed."),
		cleared: Program.input(Cleared, "A listener that holds builds lets one go."),
		raise: Program.input(
			Raise,
			"A listener that holds builds asks the owner to check one, yes or no.",
		),
	},
	outputs: {
		ask: output(
			AskShape,
			"Each ask as it starts to wait on the owner; at a start, every open one again.",
		),
		settled: output(Settled, "An answer the core took, with what it does next."),
		refused: output(Refused, "An answer the core did not take, and why. Nothing was kept."),
		waiting: output(
			Waiting,
			"Every open ask, oldest first: at the start and whenever the list changes.",
		),
		built: output(Built, "Each build as it finishes, for whoever holds builds to look at."),
		ship: output(BuildRef, "A build nothing holds: it ships."),
	},
	main: ({serve, send, flags}) =>
		Effect.gen(function* () {
			const folded = Effect.map(readFacts, foldLedger);
			const keep = (fact: Fact) =>
				sendFact(fact, {by: "asks", ...idOf(fact)}).pipe(
					Effect.catchTag("Fenced", () => Effect.die("an unfenced send was fenced")),
				);
			const ship = Effect.gen(function* () {
				for (const b of readyBuilds(yield* folded)) {
					const ref = {plan: b.plan, task: b.task, build: b.build};
					yield* keep({type: "shipped", ...ref});
					yield* send("ship", ref);
				}
			});
			const said = (before: Folded | null, after: Folded) =>
				Effect.gen(function* () {
					const was = before === null ? null : openAsks(before).map((ask) => ask.id);
					const now = openAsks(after);
					const known = new Set(was ?? []);
					yield* Effect.forEach(
						now.filter((ask: Ask) => !known.has(ask.id)),
						(ask) => send("ask", ask),
						{concurrency: 1, discard: true},
					);
					const changed = was === null || was.join("\n") !== now.map((ask) => ask.id).join("\n");
					if (changed) yield* send("waiting", {asks: now});
				});
			yield* said(null, yield* folded);
			yield* ship;

			// What was one branch of the merged loop is one function each, by what it was told.
			const fact = (fact: Fact | null) =>
				Effect.gen(function* () {
					if (fact === null) return;
					const before = yield* folded;
					yield* keep(fact);
					const after = yield* folded;
					if (fact.type === "built") {
						const build = [...after.builds.values()]
							.filter((b) => b.plan === fact.plan && b.task === fact.task)
							.at(-1);
						if (build !== undefined)
							yield* send("built", {
								plan: fact.plan,
								task: fact.task,
								changes: fact.changes,
								build: build.build,
							});
					}
					yield* said(before, after);
					yield* ship;
				});
			const answer = (answer: Answer) =>
				Effect.gen(function* () {
					const before = yield* folded;
					const problem = problemWith(before, answer);
					const ask = before.asks.get(answer.id);
					const next = ask === undefined ? null : nextOf(ask, answer.answer);
					if (problem !== null || ask === undefined || next === null)
						return yield* send("refused", {id: answer.id, why: problem ?? "it does not fit"});
					yield* keep({type: "answered", id: answer.id, answer: answer.answer});
					yield* send("settled", {ask, answer: answer.answer, next});
					yield* said(before, yield* folded);
					yield* ship;
				});

			yield* serve({
				planned: (p) => fact(factOf(p)),
				revised: (r) =>
					fact({
						type: "planned",
						plan: r.plan,
						tickets: [ticketOf(r.plan)],
						data: r.data,
						problems: [],
					}),
				reviewed: (r) => fact({type: "reviewed", ...r}),
				ruling: (r) => fact({type: "ruling_needed", ...r}),
				answer,
				build: (b) => fact({type: "built", ...b, holds: flags.holds}),
				cleared: (c) => fact({type: "cleared", ...c}),
				raise: (r) => fact({type: "check_raised", ...r}),
			});
		}),
});
