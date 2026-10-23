import {structuralHash} from "@demlik/tea";
import {noSpend, type Spend} from "@kampus/fabrika/agents/claude";
import type {SortReply} from "../stages/sort/answer.ts";
import {type Brief, sortProblems} from "../stages/sort/brief.ts";
import {
	readContext,
	readTicket,
	runSub,
	type SortCmd,
	type SortState,
	sort,
	writeOne,
} from "../stages/sort/machine.ts";
import type {Settings, SortContext, SortTicket, SortWrite} from "../stages/sort/services.ts";
import {outcomeOf, writesFor} from "../stages/sort/writes.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// The sort machine under every order of messages: its world and its laws.
//
// The world reads the ticket and the context, answers each read in any order, and may restart.
// The ticket may come back open, closed, or with its words changed. The sorter is a Sub: while an
// answer is asked for, it may send a tool call, an answer (a duplicate, a no, a fold, a ruling, each
// good or one the Check sends back), an answer that did not fit, or a failure. Each write may be
// answered or refused. A late Msg from the first run may come at any time.

export type AnySortMsg = MsgOf<typeof sort>;
type Msg = AnySortMsg;
const sortUpdate = stepOf<SortState, Msg, SortCmd>(sort);

const URL = "https://github.com/o/r/issues/5";
const KEY = "k";
const TRIES = 2;
const SETTINGS: Settings = {model: "m", effort: "low", budget: 1, note: "n"};
const TICKET: SortTicket = {url: URL, number: 5, state: "open", title: "t", body: "b"};
const CONTEXT: SortContext = {
	earlier: [{number: 2, title: "e", state: "closed", reason: null}],
	plans: [{number: 9, tickets: [9], summary: "p", approved: false}],
};
const SPENT: Spend = {...noSpend, costUsd: 1, turns: 1};

/** What the sorter may hand back, by a short name. */
export const REPLIES: Readonly<Record<string, SortReply | null>> = {
	duplicate: {sort: {answer: "duplicate", of: 2, why: "w"}},
	"duplicate of itself": {sort: {answer: "duplicate", of: 5, why: "w"}},
	no: {sort: {answer: "no", rule: "not_work", reason: "won't do: not a work item", why: "w"}},
	fold: {sort: {answer: "yes", next: "plan", partOf: 9, why: "w"}},
	"fold into no plan": {sort: {answer: "yes", next: "plan", partOf: 7, why: "w"}},
	ruling: {sort: {answer: "yes", next: "ruling", ask: "a", options: ["x", "y"], why: "w"}},
	"no fit": null,
};

const runIdOf = (s: SortState): string | null => runSub.deps(s)?.run.id ?? null;
const FIRST_RUN = `${KEY}/1`;

export function sortWorld(): World<SortState, Msg, SortCmd> {
	return {
		outside: (s) => {
			const current = runIdOf(s);
			const ids = [...new Set([...(current === null ? [] : [current]), FIRST_RUN])];
			return [
				{type: "start", ask: {ticket: URL, tries: TRIES}, settings: SETTINGS, key: KEY},
				{type: "resume"},
				...ids.flatMap((id): Msg[] => [
					{type: "sort_tool", key: KEY, id, tool: "t"},
					...Object.values(REPLIES).map(
						(output): Msg => ({
							type: "sort_finished",
							key: KEY,
							id,
							output,
							session: "s",
							spend: SPENT,
						}),
					),
					{type: "sort_failed", key: KEY, id, error: "boom", spend: SPENT},
					{type: "sort_failed", key: KEY, id, error: "error_max_budget_usd", spend: SPENT},
				]),
			];
		},
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "sort_ticket":
					return [
						readTicket.ok(cmd, TICKET, 0),
						readTicket.ok(cmd, {...TICKET, state: "closed"}, 0),
						readTicket.ok(cmd, {...TICKET, title: "t, reworded"}, 0),
						readTicket.err(cmd, {_tag: "unknown"}, 0),
					];
				case "sort_context":
					return [readContext.ok(cmd, CONTEXT, 0), readContext.err(cmd, {_tag: "unknown"}, 0)];
				case "sort_write":
					return [writeOne.ok(cmd, null, 0), writeOne.err(cmd, {_tag: "unknown"}, 0)];
			}
		},
		restart: (msg) => msg.type === "resume",
	};
}

const briefOf = (s: SortState): Brief | null =>
	s.phase === "sorting" && s.refining.phase === "drafting" ? s.refining.brief : null;

/** The ticket as the machine first read it, while it holds one. */
const ticketOf = (s: SortState): SortTicket | null => ("ticket" in s ? s.ticket : null);

const writesIn = (cmds: readonly SortCmd[]) =>
	cmds.flatMap((c): SortWrite[] => (c.type === "sort_write" ? [c.write] : []));

export function sortLaws<S extends SortState>(): readonly Law<S, Msg, SortCmd>[] {
	return [
		watched<S, Msg, SortCmd, Brief | null>(
			"an answer is acted on only once the Check passes it, and ends as that answer says",
			null,
			(brief, {prev, next}) => {
				const now = briefOf(next) ?? brief;
				if (next.phase !== "over" || prev.phase === "over") return now;
				const {outcome, report} = next;
				if (outcome.kind === "stuck" || outcome.kind === "skip") return now;
				if (report.answer === null || now === null) return broke(`${outcome.kind} with no answer`);
				if (sortProblems({sort: report.answer}, now).length > 0)
					return broke(`${outcome.kind} on an answer the Check fails`);
				return structuralHash(outcomeOf(report.answer)) === structuralHash(outcome)
					? now
					: broke(`answered ${report.answer.answer}, and ended ${outcome.kind}`);
			},
		),
		watched<S, Msg, SortCmd, boolean>(
			"nothing is written before the ticket is read again, open and unchanged",
			false,
			(passed, {prev, msg, next, cmds}) => {
				const first = ticketOf(prev);
				const door =
					passed ||
					(prev.phase === "checking" &&
						msg.type === "sort_ticket_ok" &&
						first !== null &&
						msg.value.state === "open" &&
						msg.value.title === first.title &&
						msg.value.body === first.body);
				if (writesIn(cmds).length > 0 && !door) return broke("a write went out before the door");
				return next.phase === "idle" ? false : door;
			},
		),
		law<S, Msg, SortCmd>("every write is one the answer makes, in its order", ({next, cmds}) => {
			const sent = writesIn(cmds);
			if (sent.length === 0) return null;
			if (next.phase !== "writing") return `${sent.length} writes sent from ${next.phase}`;
			const want = writesFor(next.ticket, next.answer)[next.wrote];
			return sent.length === 1 && structuralHash(sent[0]) === structuralHash(want)
				? null
				: `sent ${sent.map((w) => w.op).join(", ")} where ${want?.op ?? "nothing"} was next`;
		}),
		law<S, Msg, SortCmd>(
			"an answer ends only once every write it makes went out",
			({prev, next}) => {
				if (next.phase !== "over" || prev.phase === "over") return null;
				const {outcome, report} = next;
				if (outcome.kind === "stuck" || outcome.kind === "skip" || report.answer === null)
					return null;
				const ticket = ticketOf(prev);
				if (ticket === null) return "ended with no ticket read";
				const want = writesFor(ticket, report.answer);
				return structuralHash(report.wrote) === structuralHash(want)
					? null
					: `${report.wrote.length} of ${want.length} writes went out`;
			},
		),
		law<S, Msg, SortCmd>("a sorter Msg counts only for the run asked for", ({prev, msg, next}) =>
			(msg.type === "sort_finished" || msg.type === "sort_failed") &&
			msg.id !== runIdOf(prev) &&
			structuralHash(prev) !== structuralHash(next)
				? `${msg.type} from run ${msg.id} was taken while ${runIdOf(prev) ?? "no run"} was asked for`
				: null,
		),
		law<S, Msg, SortCmd>("tries never pass the limit asked", ({next}) => {
			const tries =
				next.phase === "sorting"
					? next.refining.phase === "drafting"
						? next.refining.tries
						: 0
					: next.phase === "over"
						? next.report.tries
						: "tries" in next
							? next.tries
							: 0;
			return tries > TRIES ? `try ${tries} of ${TRIES}` : null;
		}),
		watched<S, Msg, SortCmd, number>(
			"every dollar the sorter spent is in the report",
			0,
			(spent, {prev, msg, next}) => {
				const took =
					(msg.type === "sort_finished" || msg.type === "sort_failed") &&
					structuralHash(prev) !== structuralHash(next);
				const now = took ? spent + msg.spend.costUsd : spent;
				if (next.phase !== "over" || prev.phase === "over") return now;
				return next.report.spend.costUsd === now
					? now
					: broke(`${now} spent, and the report says ${next.report.spend.costUsd}`);
			},
		),
		law<S, Msg, SortCmd>("an ended run sends nothing", ({prev, cmds}) =>
			prev.phase === "over" && cmds.length > 0
				? `${cmds.map((c) => c.type).join(", ")} after the run ended`
				: null,
		),
	];
}

export const sortInit: SortState = {phase: "idle"};
export const sortStep: Update<SortState, Msg, SortCmd> = sortUpdate;

const nameOf = (output: SortReply | null) =>
	Object.entries(REPLIES).find(([, r]) => structuralHash(r) === structuralHash(output))?.[0] ?? "?";

export function showSortMsg(m: Msg): string {
	switch (m.type) {
		case "sort_ticket_ok":
			return `ticket read: ${m.value.state}${m.value.title === TICKET.title ? "" : ", reworded"}`;
		case "sort_finished":
			return `run ${m.id}: "${nameOf(m.output)}"`;
		case "sort_failed":
			return `run ${m.id} failed: ${m.error}`;
		case "sort_tool":
			return `run ${m.id}: tool`;
		case "sort_write_ok":
			return `${m.cmd.write.op} written`;
		case "sort_write_err":
			return `${m.cmd.write.op} refused`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** The door is skipped: an answer the Check passed is written at once. */
export const writesBeforeTheDoor: Update<SortState, Msg, SortCmd> = (s, m) => {
	const [next, cmds] = sortUpdate(s, m);
	return next.phase === "checking" && s.phase === "sorting"
		? sortUpdate(next, readTicket.ok(next.asked, next.ticket, 0))
		: [next, cmds];
};

/** A sorter Msg is taken whatever run it is from. */
export const takesAnyRun: Update<SortState, Msg, SortCmd> = (s, m) => {
	if ((m.type === "sort_finished" || m.type === "sort_failed") && s.phase === "sorting") {
		const id = runIdOf(s);
		return id === null ? sortUpdate(s, m) : sortUpdate(s, {...m, id});
	}
	return sortUpdate(s, m);
};

/** The close is left out of a no: the ticket says no and stays open. */
export const leavesANoOpen: Update<SortState, Msg, SortCmd> = (s, m) => {
	const [next, cmds] = sortUpdate(s, m);
	if (next.phase !== "writing" || next.answer.answer !== "no") return [next, cmds];
	const writes = next.writes.filter((w) => w.op !== "close");
	return [{...next, writes}, cmds];
};
