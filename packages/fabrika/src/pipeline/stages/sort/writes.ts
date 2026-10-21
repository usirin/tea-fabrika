import type {SortAnswer} from "./answer.ts";
import type {SortOutcome} from "./outcome.ts";
import type {SortTicket, SortWrite} from "./services.ts";

// What an answer writes, and what it ends in. Pure: the same ticket and answer give the same
// writes, in the same order, so a restart that sends them again sends the same ones.
//
//   duplicate of N   a comment naming N, the label `sort:duplicate`, closed as a duplicate
//   no               a comment with the reason, the label `sort:no`, closed as not planned
//   yes, plan        a comment, the label `sort:plan`; part of a plan: a link on the plan's ticket
//   yes, ruling      a comment, the label `sort:ruling`, and the ask on the owner's desk
//   yes, research    a comment, the label `sort:research`
//
// The comment goes first: it holds the answer, and the reason a later duplicate check reads. The
// label is a view for people. The ledger's outcome row is the record.

/** A sibling issue's url, by its number: the same repo as `ticket`. */
export const issueUrl = (ticket: string, number: number): string =>
	ticket.replace(/\/issues\/\d+\/?$/, `/issues/${number}`);

const said = (a: SortAnswer): {readonly head: string; readonly label: string} => {
	switch (a.answer) {
		case "duplicate":
			return {head: `Duplicate of #${a.of}.`, label: "sort:duplicate"};
		case "no":
			return {head: `No: ${a.reason.trim()}`, label: "sort:no"};
		case "yes":
			return a.next === "plan" && a.partOf !== null
				? {head: `Yes: part of the plan for #${a.partOf}.`, label: "sort:plan"}
				: {head: `Yes: next is ${a.next}.`, label: `sort:${a.next}`};
	}
};

/** The writes an answer makes, in order. */
export function writesFor(ticket: SortTicket, a: SortAnswer): readonly SortWrite[] {
	const {head, label} = said(a);
	const ruling =
		a.answer === "yes" && a.next === "ruling"
			? `\n\nAsked: ${a.ask.trim()}\nOptions:\n${a.options.map((o) => `- ${o.trim()}`).join("\n")}`
			: "";
	const comment: SortWrite = {
		op: "comment",
		ticket: ticket.url,
		body: `${head}\n\n${a.why.trim()}${ruling}`,
	};
	const labelled: SortWrite = {op: "label", ticket: ticket.url, label};
	switch (a.answer) {
		case "duplicate":
			return [comment, labelled, {op: "close", ticket: ticket.url, reason: "duplicate"}];
		case "no":
			return [comment, labelled, {op: "close", ticket: ticket.url, reason: "not_planned"}];
		case "yes":
			if (a.next === "plan" && a.partOf !== null)
				return [
					comment,
					labelled,
					{
						op: "link",
						plan: issueUrl(ticket.url, a.partOf),
						body: `#${ticket.number} is part of this plan: ${a.why.trim()}`,
					},
				];
			if (a.next === "ruling")
				return [
					comment,
					labelled,
					{
						op: "ruling",
						ticket: ticket.url,
						ask: a.ask.trim(),
						options: a.options.map((o) => o.trim()),
						why: a.why.trim(),
					},
				];
			return [comment, labelled];
	}
}

/** What an answer ends in, once its writes are out. */
export function outcomeOf(a: SortAnswer): SortOutcome {
	switch (a.answer) {
		case "duplicate":
			return {kind: "done", part: false, closed: "duplicate"};
		case "no":
			return {kind: "done", part: false, closed: "no"};
		case "yes":
			if (a.next === "ruling") return {kind: "ask", who: "owner", for: "ruling"};
			if (a.next === "research") return {kind: "send", to: "research", why: "yes"};
			return {kind: "send", to: "plan", why: a.partOf === null ? "yes" : "fold"};
	}
}
