import {Effect, Layer, Stream} from "effect";
import {Ledger, readFacts} from "../../asks/ledger.ts";
import {foldLedger, planFor} from "../../asks/rules.ts";
import {currentOf} from "../../criteria/book.ts";
import {readTicketId} from "../../ids.ts";
import {covers} from "../../tickets/approval.ts";
import {Tickets} from "../../tickets/tickets.ts";
import {BuildHost} from "../build/services.ts";
import {numberOf} from "../build/ticket.ts";
import {PlanHost} from "../plan/services.ts";
import {repoRulesOf} from "../rules.ts";
import {SortHost, SortWrites} from "../sort/services.ts";
import {LaneWork} from "./work.ts";

// What the lane's steps read and say, on the tracker's tickets and this machine's clone. Today's
// version. No GitHub issue is ever read: a ticket's title and body come from the app's ledger.
//
//   SortHost    the ticket, by its url's number
//   SortWrites  a comment or a close on the ticket; a label has no home here and is dropped
//   PlanHost    the ticket, planned at main's tip
//   BuildHost   the ticket, its criteria from the plan's book, the plan approved or not by a
//               person's answer on the ticket, and the repo's rules at main

type Failed = {readonly _tag: "unknown"};
const failed: Failed = {_tag: "unknown"};

/** A lane's ticket as the machines name it. Nothing reads GitHub by this url. Pure. */
export const ticketUrlOf = (repo: string, n: number): string =>
	`https://github.com/${repo}/issues/${n}`;

const read = (url: string) =>
	Effect.gen(function* () {
		const tickets = yield* Tickets;
		return yield* tickets.read(numberOf(url)).pipe(Effect.mapError(() => failed));
	});

const bodyOf = (ticket: {
	readonly timeline: readonly {readonly fact: {readonly type: string}}[];
}) => {
	const filed = ticket.timeline[0]?.fact as
		| {readonly type: string; readonly body?: string}
		| undefined;
	return filed?.type === "filed" ? (filed.body ?? "") : "";
};

export const laneSortHost = Layer.effect(
	SortHost,
	Effect.gen(function* () {
		const tickets = yield* Tickets;
		return {
			ticket: (url: string) =>
				read(url).pipe(
					Effect.provideService(Tickets, tickets),
					Effect.map((t) => ({
						url,
						number: t.number,
						state: t.state === "closed" ? ("closed" as const) : ("open" as const),
						title: t.title,
						body: bodyOf(t),
					})),
				),
			// Other tickets are not read in v0: triage judges this ticket alone.
			earlier: () => Effect.succeed([]),
		};
	}),
);

export const laneSortWrites = Layer.effect(
	SortWrites,
	Effect.gen(function* () {
		const tickets = yield* Tickets;
		const say = (url: string, intent: string, body: string) =>
			tickets.talk(numberOf(url), intent, {type: "commented", body}).pipe(
				Effect.as(null),
				Effect.mapError(() => failed),
			);
		return {
			write: (write, intent) => {
				switch (write.op) {
					case "comment":
						return say(write.ticket, intent, write.body);
					case "close":
						return tickets.talk(numberOf(write.ticket), intent, {type: "closed"}).pipe(
							Effect.as(null),
							Effect.mapError(() => failed),
						);
					case "ruling":
						return say(write.ticket, intent, `${write.ask}\n\n${write.why}`);
					case "fold":
						return say(write.ticket, intent, `Part of the plan ${write.plan}.`);
					case "label":
					case "link":
						return Effect.succeed(null);
				}
			},
		};
	}),
);

export const lanePlanHost = Layer.effect(
	PlanHost,
	Effect.gen(function* () {
		const tickets = yield* Tickets;
		const work = yield* LaneWork;
		return {
			ticket: (url: string) =>
				Effect.gen(function* () {
					const t = yield* read(url).pipe(Effect.provideService(Tickets, tickets));
					return {
						url,
						number: t.number,
						state: t.state === "closed" ? ("closed" as const) : ("open" as const),
						title: t.title,
						body: bodyOf(t),
						at: yield* work.main,
					};
				}),
		};
	}),
);

export const laneBuildHost = Layer.effect(
	BuildHost,
	Effect.gen(function* () {
		const tickets = yield* Tickets;
		const work = yield* LaneWork;
		const ledger = yield* Ledger;
		return {
			ticket: (url: string, number: number) =>
				Effect.gen(function* () {
					const t = yield* read(url).pipe(Effect.provideService(Tickets, tickets));
					const id = readTicketId(url);
					if (id === null) return yield* Effect.fail(failed);
					const state = foldLedger(yield* Effect.provideService(readFacts, Ledger, ledger));
					const plan = planFor(state, id);
					const track = plan === null ? undefined : state.plans.get(plan);
					const tip = yield* work.main;
					const blob = (text: string | null) => (text === null ? null : {text});
					const approved = t.timeline.some(
						(e) =>
							e.by.kind === "user" &&
							e.fact.type === "answered" &&
							e.fact.ask.startsWith("a-approve-") &&
							e.fact.pick === "approve",
					);
					return {
						url,
						number,
						state: t.state === "closed" ? ("closed" as const) : ("open" as const),
						title: t.title,
						body: bodyOf(t),
						criteria:
							track === undefined
								? null
								: currentOf(track.book).map((c) => ({
										id: c.id,
										version: c.version,
										text: c.text,
										checked: false,
										evidence: null,
									})),
						prs: [],
						rules: repoRulesOf({
							claudeMd: blob(yield* work.show(tip, "CLAUDE.md")),
							agentsMd: blob(yield* work.show(tip, "AGENTS.md")),
						}),
						plan:
							track === undefined
								? ("none" as const)
								: approved
									? ("approved" as const)
									: ("not_approved" as const),
					};
				}),
		};
	}),
);

/**
 * A person's answer to `ask`, heard once, looked for each second as the tracker's own window does.
 * Only a person's counts: an agent's row is passed over. An `approve` counts only while it covers
 * the ticket's text as it reads now, so an edit after it is asked again.
 */
export const answerHeard = (number: number, ask: string, picks: readonly string[]) =>
	Stream.unwrap(
		Effect.gen(function* () {
			const tickets = yield* Tickets;
			const look = Effect.gen(function* () {
				const ticket = yield* tickets.read(number);
				for (const entry of ticket.timeline) {
					const {fact} = entry;
					if (entry.by.kind !== "user" || fact.type !== "answered" || fact.ask !== ask) continue;
					if (!picks.includes(fact.pick)) continue;
					if (fact.pick === "approve" && !(yield* covers(fact, ticket))) continue;
					return {ask, pick: fact.pick, note: fact.note};
				}
				return null;
			}).pipe(Effect.orElseSucceed(() => null));
			const wait: Effect.Effect<{
				readonly ask: string;
				readonly pick: string;
				readonly note: string;
			}> = look.pipe(
				Effect.flatMap((heard) =>
					heard === null ? Effect.andThen(Effect.sleep("1 second"), wait) : Effect.succeed(heard),
				),
			);
			return Stream.fromEffect(wait);
		}),
	);
