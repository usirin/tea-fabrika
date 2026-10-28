import {Writer} from "@kampus/fabrika";
import {textOf} from "@kampus/pipeline/tickets/approval";
import {
	Body,
	factsOf,
	Id,
	PrState,
	type Ticket,
	TicketNumber,
} from "@kampus/pipeline/tickets/ticket";
import {
	checksLine,
	Failed,
	Opened,
	openedOf,
	StepNow,
	stepsOf,
	type Tracker,
	Write,
} from "@tea-fabrika/tracker";
import {Schema} from "effect";

// What the ticket program's window is shown: one ticket, as its page reads, with the properties
// the panel beside it lists. Pure, made on the host from the tracker machine's state, so the
// window draws words and never folds a fact.
//
//   shownOf(state)   // state.open = 7, read from the ledger
//   // {ready: true, number: 7, page: {opened: {ticket, head: {_tag: "asks", ...}, rows, asks},
//   //   body: "Every line ...", steps: [...nine], plan: {version: 1, tasks: ["t-1", "t-2"]},
//   //   pr: null, usd: 0.49, filed: {by: user:owner, at}}, saving: [], ...}

/** The newest plan: its version and its tasks. */
export const Plan = Schema.Struct({version: Schema.Int, tasks: Schema.Array(Id)});

/** The newest pull request fact: where it is, its state, and its checks in one line. */
export const Pr = Schema.Struct({url: Schema.String, state: PrState, checks: Schema.String});

export const Page = Schema.Struct({
	opened: Opened,
	/** The body it was filed with: what an answer says the person saw, with the title. */
	body: Body,
	/** Who filed it, and when: the first fact of every ticket the fold keeps. */
	filed: Schema.NullOr(Schema.Struct({by: Writer, at: Schema.Finite})),
	/** The plan's nine steps, from its facts. */
	steps: Schema.Array(StepNow),
	plan: Schema.NullOr(Plan),
	pr: Schema.NullOr(Pr),
	/** What every run on it cost, from each `ended`. */
	usd: Schema.Finite,
});
export type Page = typeof Page.Type;

export const Shown = Schema.Struct({
	/** The ledger has been read once. */
	ready: Schema.Boolean,
	/** The ticket it shows. `null` only before main opens it, at start. */
	number: Schema.NullOr(TicketNumber),
	/** `null`: no ticket has that number, or the ledger has not been read yet. */
	page: Schema.NullOr(Page),
	/** Writes not on the ledger yet, in the order asked. */
	saving: Schema.Array(Write),
	failed: Schema.NullOr(Failed),
	unreachable: Schema.NullOr(Schema.String),
	/** The clock's last tick. 0: none yet. */
	now: Schema.Finite,
});
export type Shown = typeof Shown.Type;

/** One ticket's page, at `now`. */
export const pageOf = (ticket: Ticket, now: number): Page => {
	const timeline = ticket.timeline;
	const plan = factsOf(timeline, "planned").at(-1);
	const pr = factsOf(timeline, "pr").at(-1);
	const first = timeline[0];
	return {
		opened: openedOf(ticket, now),
		body: textOf(ticket).body,
		filed: first === undefined ? null : {by: first.by, at: first.at},
		steps: stepsOf(timeline),
		plan: plan === undefined ? null : {version: plan.version, tasks: plan.tasks},
		pr: pr === undefined ? null : {url: pr.url, state: pr.state, checks: checksLine(pr.checks)},
		usd: factsOf(timeline, "ended").reduce((sum, e) => sum + e.usd, 0),
	};
};

/** The view: the ticket the machine has open. Its number is the machine's `open`, set at start. */
export const shownOf = (s: Tracker): Shown => {
	const ticket = s.tickets.find((t) => t.number === s.open);
	return {
		ready: s.ready,
		number: s.open,
		page: ticket === undefined ? null : pageOf(ticket, s.now),
		saving: s.saving.map((w) => w.write),
		failed: s.failed,
		unreachable: s.unreachable,
		now: s.now,
	};
};
