import {Ledger} from "@kampus/fabrika";
import type {DraftMsg, DraftRun} from "@kampus/fabrika/agents/claude";
import {Context, Effect, Layer, Schema, type Stream} from "effect";
import {readFacts} from "../../asks/ledger.ts";
import {foldLedger} from "../../asks/rules.ts";
import {ask, type Gh} from "../../code-host-github.ts";
import {readTicketId} from "../../ids.ts";
import {ticketOf} from "../build/ticket.ts";
import {EFFORTS} from "../plan/services.ts";
import type {SortReply} from "./answer.ts";

// What the sort stage reads, the one agent it runs, and where its writes go, each behind a service
// so a host picks the implementation:
//
//   SortHost    the ticket, and every other ticket of its repo, open or closed: GitHub (below),
//               or experiment 111's fake
//   SortPlans   the plans still open, from the pipeline's facts on the ledger (below)
//   Sorter      the sorter's run (./sorter.ts)
//   SortWrites  the writes sort's answer makes: a comment, a label, a close, a link on a plan's
//               ticket, a ruling for the owner's desk. On tea-host each goes through the
//               idempotency gate (../../hosted/sort.ts)

type Failed = {readonly _tag: "unknown"};

/** A ticket as sort reads it. */
export const SortTicket = Schema.Struct({
	url: Schema.String,
	number: Schema.Int,
	state: Schema.Literals(["open", "closed"]),
	title: Schema.String,
	body: Schema.String,
});
export type SortTicket = typeof SortTicket.Type;

/**
 * Another ticket of the repo, open or closed. `reason`: for a ticket sort closed, the reason its
 * "no" or "duplicate" gave, so a new report about the same thing finds it (the duplicate check
 * reads closed tickets too). `null`: open, or closed without one.
 */
export const Earlier = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	state: Schema.Literals(["open", "closed"]),
	reason: Schema.NullOr(Schema.String),
});
export type Earlier = typeof Earlier.Type;

/** A plan still open: named by its first ticket, the tickets it covers, and what it is about. */
export const OpenPlan = Schema.Struct({
	number: Schema.Int,
	tickets: Schema.Array(Schema.Int),
	summary: Schema.String,
	approved: Schema.Boolean,
});
export type OpenPlan = typeof OpenPlan.Type;

/** What sort reads around the ticket: the repo's other tickets, and its open plans. */
export const SortContext = Schema.Struct({
	earlier: Schema.Array(Earlier),
	plans: Schema.Array(OpenPlan),
});
export type SortContext = typeof SortContext.Type;

/** How one sorter run is to spend, and what the repo is, in a few lines for the brief. */
export const Settings = Schema.Struct({
	model: Schema.String,
	effort: Schema.Literals(EFFORTS),
	budget: Schema.Finite,
	/** What the repo is, for the sorter: a few plain lines. */
	note: Schema.String,
});
export type Settings = typeof Settings.Type;

export type SortMsg = DraftMsg<"sort", SortReply>;

/**
 * One write sort's answer makes. `ticket` and `plan` are issue urls. A `ruling` goes to the owner's
 * desk on the ledger, not to the code host; a `fold` goes to the plan's facts on the ledger, so the
 * plan covers the ticket and its next version is planned with it.
 */
export const SortWrite = Schema.Union([
	Schema.Struct({op: Schema.Literal("comment"), ticket: Schema.String, body: Schema.String}),
	Schema.Struct({op: Schema.Literal("label"), ticket: Schema.String, label: Schema.String}),
	Schema.Struct({
		op: Schema.Literal("close"),
		ticket: Schema.String,
		reason: Schema.Literals(["not_planned", "duplicate"]),
	}),
	Schema.Struct({op: Schema.Literal("link"), plan: Schema.String, body: Schema.String}),
	Schema.Struct({op: Schema.Literal("fold"), plan: Schema.String, ticket: Schema.String}),
	Schema.Struct({
		op: Schema.Literal("ruling"),
		ticket: Schema.String,
		ask: Schema.String,
		options: Schema.Array(Schema.String),
		why: Schema.String,
	}),
]);
export type SortWrite = typeof SortWrite.Type;

export class SortHost extends Context.Service<
	SortHost,
	{
		readonly ticket: (url: string) => Effect.Effect<SortTicket, Failed>;
		/** Every other ticket of the ticket's repo, open or closed, newest first. */
		readonly earlier: (ticket: SortTicket) => Effect.Effect<readonly Earlier[], Failed>;
	}
>()("@kampus/fabrika/pipeline/SortHost") {}

export class SortPlans extends Context.Service<
	SortPlans,
	{readonly open: (ticket: SortTicket) => Effect.Effect<readonly OpenPlan[], Failed>}
>()("@kampus/fabrika/pipeline/SortPlans") {}

/**
 * The sorter, as a service: one run in, its stream of Msgs out, ending with one `sort_finished` or
 * `sort_failed`. A test stands a scripted one in.
 */
export class Sorter extends Context.Service<
	Sorter,
	{readonly run: (run: DraftRun, settings: Settings) => Stream.Stream<SortMsg>}
>()("@kampus/fabrika/pipeline/Sorter") {}

/** Where sort's writes go. `intent` names the write: the same write sent again has the same one. */
export class SortWrites extends Context.Service<
	SortWrites,
	{readonly write: (write: SortWrite, intent: string) => Effect.Effect<null, Failed>}
>()("@kampus/fabrika/pipeline/SortWrites") {}

// ---------------------------------------------------------------- the plans, from the ledger

/** The repo part of a ticket id: `owner/name`. */
const repoOfId = (id: string) => id.slice(0, id.indexOf("#"));
const numberOfId = (id: string) => Number(id.slice(id.indexOf("#") + 1));

/**
 * The plans still open in the ticket's repo, read fresh from the pipeline's facts: every plan with a
 * version and no "no" from the owner. Its summary is the version it works from (the approved one,
 * else the newest).
 */
export const ledgerPlans = Layer.effect(
	SortPlans,
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		return SortPlans.of({
			open: (ticket) =>
				Effect.gen(function* () {
					const id = readTicketId(ticket.url);
					if (id === null) return yield* Effect.fail({_tag: "unknown" as const});
					const state = foldLedger(yield* readFacts);
					const out: OpenPlan[] = [];
					for (const [plan, track] of state.plans) {
						if (track.closed !== null || repoOfId(plan) !== repoOfId(id)) continue;
						const data = track.approved?.data ?? track.versions.at(-1)?.data;
						if (data === undefined) continue;
						out.push({
							number: numberOfId(plan),
							tickets: track.tickets.map(numberOfId),
							summary: data.summary,
							approved: track.approved !== null,
						});
					}
					return out;
				}).pipe(Effect.provideService(Ledger, ledger)),
		});
	}),
);

// ---------------------------------------------------------------- the GitHub reads

const TICKET = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { state title body }
  }
}`;
const TicketAnswer = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			issue: Schema.Struct({
				state: Schema.Literals(["OPEN", "CLOSED"]),
				title: Schema.String,
				body: Schema.String,
			}),
		}),
	}),
});

const LIST = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number title state
        comments(last: 20) { nodes { body } }
      }
    }
  }
}`;
const ListAnswer = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			issues: Schema.Struct({
				nodes: Schema.Array(
					Schema.Struct({
						number: Schema.Int,
						title: Schema.String,
						state: Schema.Literals(["OPEN", "CLOSED"]),
						comments: Schema.Struct({nodes: Schema.Array(Schema.Struct({body: Schema.String}))}),
					}),
				),
			}),
		}),
	}),
});

/** The marker a sort write leaves in its comment (../../hosted/idempotency.ts `markerOf`). */
const SORT_MARK = /<!-- fabrika-key: sort:[^#]+#comment:/;

/**
 * The reason a sort comment gave for a no or a duplicate: its first line. `null`: the ticket has no
 * such comment. Pure.
 */
export const reasonIn = (comments: readonly string[]): string | null => {
	const said = comments.findLast((c) => SORT_MARK.test(c));
	if (said === undefined) return null;
	const first = said.split("\n")[0]?.trim() ?? "";
	return /^(No|Duplicate)\b/.test(first) ? first : null;
};

/** The ticket and its repo's other tickets on GitHub, read only. The newest 100 tickets are read. */
export const githubSortHost = (gh: Gh) =>
	Layer.succeed(SortHost, {
		ticket: (url) =>
			Effect.gen(function* () {
				const at = ticketOf(url);
				if (at === null) return yield* Effect.fail({_tag: "unknown" as const});
				const {issue} = (yield* ask(gh, TicketAnswer, TICKET, {
					owner: at.owner,
					name: at.name,
					number: at.number,
				})).data.repository;
				return {
					url,
					number: at.number,
					state: issue.state === "OPEN" ? "open" : "closed",
					title: issue.title,
					body: issue.body,
				} satisfies SortTicket;
			}),
		earlier: (ticket) =>
			Effect.gen(function* () {
				const at = ticketOf(ticket.url);
				if (at === null) return yield* Effect.fail({_tag: "unknown" as const});
				const nodes = (yield* ask(gh, ListAnswer, LIST, {owner: at.owner, name: at.name})).data
					.repository.issues.nodes;
				return nodes
					.filter((n) => n.number !== ticket.number)
					.map(
						(n): Earlier => ({
							number: n.number,
							title: n.title,
							state: n.state === "OPEN" ? "open" : "closed",
							reason: n.state === "OPEN" ? null : reasonIn(n.comments.nodes.map((c) => c.body)),
						}),
					);
			}),
	});
