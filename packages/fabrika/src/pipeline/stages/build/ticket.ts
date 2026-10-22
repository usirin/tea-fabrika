import {Effect, Schema} from "effect";
import {ask, type Gh} from "../../code-host-github.ts";
import {CriterionId} from "../../ids.ts";
import {Criterion, criteriaIn} from "../review/pack.ts";
import {RepoRule, RULES_FIELDS, RuleBlob, repoRulesOf, rulesAt} from "../rules.ts";
import type {BuildOutcome} from "./outcome.ts";

// What the build stage reads and decides before any agent runs: the ticket,
// the pull request already open from its branch, and the gate. The gate is
// pure: the same ticket gives the same answer.

const TICKET_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/([1-9]\d*)$/;

/** A ticket on GitHub, whole: `https://github.com/<owner>/<repo>/issues/<number>`. Any repository. */
export const TicketUrl = Schema.String.check(
	Schema.isPattern(TICKET_URL, {
		message: "not a ticket url: it looks like https://github.com/<owner>/<repo>/issues/<number>",
	}),
).annotate({description: "https://github.com/<owner>/<repo>/issues/<number>"});

/** Where a ticket lives, read out of a url `TicketUrl` took. */
export interface TicketAt {
	readonly owner: string;
	readonly name: string;
	readonly number: number;
}

/** The repository and number of a ticket url. `null`: not one. */
export const ticketOf = (url: string): TicketAt | null => {
	const m = TICKET_URL.exec(url);
	return m === null ? null : {owner: m[1] as string, name: m[2] as string, number: Number(m[3])};
};

/** A ticket's number, from a url `TicketUrl` took. */
export const numberOf = (url: string): number => Number(url.slice(url.lastIndexOf("/") + 1));

/** The branch a ticket is built on. One per ticket, so every round lands on the same pull request. */
export const branchOf = (number: number): string => `build/${number}`;

/** A pull request from the ticket's branch, as it stands. */
export const Opened = Schema.Struct({
	url: Schema.String,
	state: Schema.Literals(["open", "closed", "merged"]),
	head: Schema.String,
});
export type Opened = typeof Opened.Type;

/**
 * How a ticket's plan stands on the ledger, as the build gate reads it. The
 * one thing that lets a ticket be built is an approved plan, kept on the
 * ledger (docs/direction/sort-answers-yes-or-no.md); a label is never read.
 * `approved`: the owner approved a version of the plan that names the ticket,
 * and did not say no to it since. `not_approved`: a plan names it, and no
 * version is approved, or the owner said no. `none`: no plan names it.
 * `unknown`: the ledger could not be read, which never reads as approved.
 */
export const PLAN_STATES = ["approved", "not_approved", "none", "unknown"] as const;
export type PlanState = (typeof PLAN_STATES)[number];

/** The ticket, read whole. */
export const Ticket = Schema.Struct({
	url: Schema.String,
	number: Schema.Finite,
	state: Schema.Literals(["open", "closed"]),
	title: Schema.String,
	body: Schema.String,
	/** Its acceptance criteria, under their ids (`criteriaIn`, ../review/pack.ts). Empty: none listed. `null`: the list would need a guess. */
	criteria: Schema.NullOr(Schema.Array(Criterion)),
	/** Pull requests from its branch, newest first. */
	prs: Schema.Array(Opened),
	/** The repository's rules for agents, on the branch pull requests go to (../rules.ts). Empty: it has none. */
	rules: Schema.Array(RepoRule),
	/**
	 * How its plan stands on the ledger (./go.ts). Left out: read as
	 * `unknown`, so a ticket kept from before the plan was read with it is
	 * never built.
	 */
	plan: Schema.optionalKey(Schema.Literals(PLAN_STATES)),
});
export type Ticket = typeof Ticket.Type;

/**
 * One thing a review left open, as the next build round is told it. The
 * parent makes these from the review's criteria (../operate/stop.ts); a first
 * round has none.
 */
export const Item = Schema.Struct({
	/** The criterion it is, by id. `null`: something no criterion names (a review's own finding, red checks, a ship send-back). */
	criterion: Schema.NullOr(CriterionId),
	text: Schema.String,
	/** Why it is open, in the reviewer's words. */
	says: Schema.String,
	/** Where it shows: `file:first-last`. */
	where: Schema.Array(Schema.String),
	/** What has to be true for it to close, one per finding. */
	wants: Schema.Array(Schema.String),
});
export type Item = typeof Item.Type;

/** Go, or the one reason not to. */
export type BuildGate =
	/** `criteria`: at least one, so nothing after the gate asks again. */
	| {readonly answer: "go"; readonly criteria: readonly [Criterion, ...Criterion[]]}
	| {readonly answer: "stop"; readonly outcome: BuildOutcome};

/**
 * What each state of a ticket's plan does at the gate: go on (`null`), or
 * stop with this outcome. A `Record` over every state, so a new state cannot
 * be added without a row, and `unknown` has a stop of its own: the type has
 * no row in which a ledger that could not be read lets a build through.
 */
const AT_THE_GATE: {readonly [S in PlanState]: S extends "approved" ? null : BuildOutcome} = {
	approved: null,
	not_approved: {kind: "skip", why: "not_ready"},
	none: {kind: "skip", why: "not_ready"},
	unknown: {kind: "stuck", why: "read_failed"},
};

export function buildGate(ticket: Ticket): BuildGate {
	if (ticket.state === "closed") return {answer: "stop", outcome: {kind: "skip", why: "closed"}};
	if (ticket.prs.some((pr) => pr.state === "merged"))
		return {answer: "stop", outcome: {kind: "skip", why: "merged"}};
	const stop = AT_THE_GATE[ticket.plan ?? "unknown"];
	if (stop !== null) return {answer: "stop", outcome: stop};
	if (ticket.criteria === null)
		return {answer: "stop", outcome: {kind: "stuck", why: "criteria_unknown"}};
	const [first, ...rest] = ticket.criteria;
	if (first === undefined) return {answer: "stop", outcome: {kind: "stuck", why: "no_criteria"}};
	return {answer: "go", criteria: [first, ...rest]};
}

/** The open pull request from the branch, if there is one. */
export const openOf = (ticket: Ticket): Opened | null =>
	ticket.prs.find((pr) => pr.state === "open") ?? null;

// ---------------------------------------------------------------- the read

const TICKET = `
query($owner: String!, $name: String!, $number: Int!, $branch: String!, $claudeMd: String!, $agentsMd: String!) {
  repository(owner: $owner, name: $name) {
    ${RULES_FIELDS}
    issue(number: $number) { state title body }
    pullRequests(headRefName: $branch, first: 10, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { url state headRefOid }
    }
  }
}`;

const Answer = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			claudeMd: RuleBlob,
			agentsMd: RuleBlob,
			issue: Schema.Struct({
				state: Schema.Literals(["OPEN", "CLOSED"]),
				title: Schema.String,
				body: Schema.String,
			}),
			pullRequests: Schema.Struct({
				nodes: Schema.Array(
					Schema.Struct({
						url: Schema.String,
						state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
						headRefOid: Schema.String,
					}),
				),
			}),
		}),
	}),
});

/** Read one ticket and the pull requests from its branch, in the repository its url names. */
export const readTicket =
	(gh: Gh) =>
	(url: string, number: number): Effect.Effect<Ticket, {readonly _tag: "unknown"}> =>
		Effect.gen(function* () {
			const at = ticketOf(url);
			if (at === null) return yield* Effect.fail({_tag: "unknown" as const});
			const {repository} = (yield* ask(gh, Answer, TICKET, {
				owner: at.owner,
				name: at.name,
				number,
				branch: branchOf(number),
				// The branch every pull request here is opened against (./github.ts).
				...rulesAt("main"),
			})).data;
			const {issue} = repository;
			return {
				url,
				number,
				state: issue.state === "OPEN" ? "open" : "closed",
				title: issue.title,
				body: issue.body,
				criteria: criteriaIn(issue.body),
				prs: repository.pullRequests.nodes.map((pr) => ({
					url: pr.url,
					state: pr.state === "OPEN" ? "open" : pr.state === "MERGED" ? "merged" : "closed",
					head: pr.headRefOid,
				})),
				rules: repoRulesOf(repository),
			} satisfies Ticket;
		});
