import {Effect, Schema} from "effect";
import {ask, type Gh} from "../../code-host-github";
import {SANDBOX} from "../../sandbox";
import {Criterion, criteriaIn} from "../review/pack";
import type {BuildOutcome} from "./outcome";

// What the build stage reads and decides before any agent runs: the ticket,
// the pull request already open from its branch, and the gate. The gate is
// pure: the same ticket gives the same answer.

/** The label a ticket carries when an agent may build it. */
export const READY = "ready-for:agent";

/** The branch a ticket is built on. One per ticket, so every round lands on the same pull request. */
export const branchOf = (number: number): string => `build/${number}`;

/** A pull request from the ticket's branch, as it stands. */
export const Opened = Schema.Struct({
	url: Schema.String,
	state: Schema.Literals(["open", "closed", "merged"]),
	head: Schema.String,
});
export type Opened = typeof Opened.Type;

/** The ticket, read whole. */
export const Ticket = Schema.Struct({
	url: Schema.String,
	number: Schema.Finite,
	state: Schema.Literals(["open", "closed"]),
	title: Schema.String,
	body: Schema.String,
	labels: Schema.Array(Schema.String),
	/** Its acceptance criteria, numbered (`criteriaIn`, ../review/pack.ts). Empty: none listed. */
	criteria: Schema.Array(Criterion),
	/** Pull requests from its branch, newest first. */
	prs: Schema.Array(Opened),
});
export type Ticket = typeof Ticket.Type;

/**
 * One thing a review left open, as the next build round is told it. The
 * parent makes these from the review's criteria (../operate/stop.ts); a first
 * round has none.
 */
export const Item = Schema.Struct({
	/** The criterion's number, or 0 for something no criterion names (red checks, a ship send-back). */
	n: Schema.Finite,
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

export function buildGate(ticket: Ticket): BuildGate {
	if (ticket.state === "closed") return {answer: "stop", outcome: {kind: "skip", why: "closed"}};
	if (ticket.prs.some((pr) => pr.state === "merged"))
		return {answer: "stop", outcome: {kind: "skip", why: "merged"}};
	if (!ticket.labels.includes(READY))
		return {answer: "stop", outcome: {kind: "skip", why: "not_ready"}};
	const [first, ...rest] = ticket.criteria;
	if (first === undefined) return {answer: "stop", outcome: {kind: "stuck", why: "no_criteria"}};
	return {answer: "go", criteria: [first, ...rest]};
}

/** The open pull request from the branch, if there is one. */
export const openOf = (ticket: Ticket): Opened | null =>
	ticket.prs.find((pr) => pr.state === "open") ?? null;

// ---------------------------------------------------------------- the read

const TICKET = `
query($owner: String!, $name: String!, $number: Int!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { state title body labels(first: 50) { nodes { name } } }
    pullRequests(headRefName: $branch, first: 10, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { url state headRefOid }
    }
  }
}`;

const Answer = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			issue: Schema.Struct({
				state: Schema.Literals(["OPEN", "CLOSED"]),
				title: Schema.String,
				body: Schema.String,
				labels: Schema.Struct({nodes: Schema.Array(Schema.Struct({name: Schema.String}))}),
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

/**
 * Read one sandbox ticket and the pull requests from its branch. The url is
 * one the program's input took, so it is in the sandbox; the owner and name
 * asked for are the sandbox's own, never read out of the url.
 */
export const readTicket =
	(gh: Gh) =>
	(url: string, number: number): Effect.Effect<Ticket, {readonly _tag: "unknown"}> =>
		Effect.gen(function* () {
			const [owner, name] = SANDBOX.split("/") as [string, string];
			const {repository} = (yield* ask(gh, Answer, TICKET, {
				owner,
				name,
				number,
				branch: branchOf(number),
			})).data;
			const {issue} = repository;
			return {
				url,
				number,
				state: issue.state === "OPEN" ? "open" : "closed",
				title: issue.title,
				body: issue.body,
				labels: issue.labels.nodes.map((label) => label.name),
				criteria: criteriaIn(issue.body),
				prs: repository.pullRequests.nodes.map((pr) => ({
					url: pr.url,
					state: pr.state === "OPEN" ? "open" : pr.state === "MERGED" ? "merged" : "closed",
					head: pr.headRefOid,
				})),
			} satisfies Ticket;
		});
