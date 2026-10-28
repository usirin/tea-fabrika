import {type Row, Writer, type Writes, writerOf} from "@kampus/fabrika";
import {Option, Schema} from "effect";

// A ticket: one stream of facts on the ledger, and nothing else
// (docs/direction/tickets-start-in-our-tracker.md). Ticket 3 is the registered name
// `tracker/ticket/3`, and its facts are the messages in that name's inbox, oldest first. The row
// says who wrote a fact (a user or an agent) and when; the fact says only what happened:
//
//   tracker/ticket/3/inbox   {type: "filed", title: "Login fails", body: "On main."}   user:owner
//                            {type: "commented", body: "Seen it too."}                  agent:review
//                            {type: "closed"}                                           user:owner
//
//   fold([], entries).tickets   [{number: 3, title: "Login fails", state: "closed", timeline: [3 entries]}]
//
// A state change is a fact of its own (`closed`, `reopened`), never a comment. The facts live in
// the pipeline, so a lane reads and writes the same ones the tracker shows
// (docs/direction/a-ticket-runs-from-the-app.md, section 3); the tracker imports them. This file
// is pure: ./tickets.ts reads and writes the ledger, and so does the tracker's own ledger.ts.

/** A ticket's number: 1, 2, 3, in the order the tickets were filed. */
export const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** One line, with no space at either end. */
export const Title = Schema.String.check(
	Schema.isTrimmed(),
	Schema.isNonEmpty(),
	Schema.isMaxLength(256),
	Schema.isPattern(/^[^\r\n]*$/),
);

/** A ticket's body: any text, empty too. */
export const Body = Schema.String.check(Schema.isMaxLength(65_536));

/** A comment's text: a body with something in it besides spaces. */
export const Said = Body.check(Schema.isPattern(/\S/));

// ---------------------------------------------------------------- what a lane writes
//
// Nine more kinds, the facts a lane works with
// (docs/direction/what-a-ticket-shows.md, section 2). Each is a tagged struct under `type`, the
// key the tracker's first four already use on the ledger, so the rows written before still read.
// The fields added since (`asks` on a comment, `text` on an answer) are optional for that reason.
//
//   {type: "started", run: "r-7", stage: "build", task: "t-2", log: null}            code
//   {type: "ended", run: "r-7", stage: "build", outcome: {kind: "send", to: "review", why: "built"},
//    usd: 0.41, input: 12000, output: 3000, turns: 14}                               code
//   {type: "asked", ask: "a-1", what: "approve plan v2", picks: ["approve", "no"]}   the stage that asks
//   {type: "answered", ask: "a-1", pick: "approve", note: "", text: "sha256:9c1f…"}  a user, never an agent

/** One stage's name, as the pipeline spells it: `triage`, `build`, `review`, `test_writer`. */
export const Stage = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,31}$/));

/** An id on one line with no spaces: a run's (`r-7`), an ask's (`a-1`), a task's, a finding's. */
export const Id = Schema.String.check(Schema.isPattern(/^\S{1,128}$/));

/** A commit's sha: 7 to 64 hex digits. */
export const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,64}$/));

/** A count: 0, 1, 2. */
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** A stage's answer, in the five verbs (docs/direction/outcome-names.md): the `AnyOutcome` shape. */
export const Outcome = Schema.Union([
	Schema.Struct({kind: Schema.Literal("done"), part: Schema.Boolean}),
	Schema.Struct({kind: Schema.Literal("send"), to: Stage, why: Schema.String}),
	Schema.Struct({kind: Schema.Literal("ask"), who: Schema.String, for: Schema.String}),
	Schema.Struct({kind: Schema.Literal("skip"), why: Schema.String}),
	Schema.Struct({kind: Schema.Literal("stuck"), why: Schema.String}),
]);
export type Outcome = typeof Outcome.Type;

/** One check on a pull request, in GitHub's own words (the REST API's check runs). */
export const Check = Schema.Struct({
	name: Title,
	status: Schema.Literals(["queued", "in_progress", "completed"]),
	/** Set once it is `completed`. */
	conclusion: Schema.NullOr(
		Schema.Literals([
			"success",
			"failure",
			"neutral",
			"cancelled",
			"skipped",
			"timed_out",
			"action_required",
			"stale",
		]),
	),
});
export type Check = typeof Check.Type;

/** A pull request's state, as the watcher read it from GitHub. */
export const PrState = Schema.Literals(["draft", "open", "merged", "closed"]);

/** A hash of some text, as the facts spell it: `sha256:` and 64 hex digits. */
export const Hash = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
export type Hash = typeof Hash.Type;

/**
 * What a comment asks for. Missing: nothing, it is talk. `changes`: the person clicked "Request
 * changes", GitHub's word in its review box. A person's stops build and asks for a new plan or a
 * new yes; an agent's stops nothing (./yes.ts).
 */
export const Asks = Schema.Literal("changes");

/** The tracker's own four: a ticket filed, talked about, closed and opened again. */
export const TicketFact = Schema.Union([
	Schema.Struct({type: Schema.Literal("filed"), title: Title, body: Body}),
	Schema.Struct({type: Schema.Literal("commented"), body: Said, asks: Schema.optionalKey(Asks)}),
	Schema.Struct({type: Schema.Literal("closed")}),
	Schema.Struct({type: Schema.Literal("reopened")}),
]);

/**
 * The lane facts code writes, through `Tickets.write`: every one but a person's `answered` and
 * `rated`. A lane cannot even spell an answer to its own ask, and `Tickets.write` checks it again
 * at run time, so a cast one is refused too.
 */
export const CodeFact = Schema.Union([
	/** Code started an agent run. `log`: where its own log is, once there is one. */
	Schema.Struct({
		type: Schema.Literal("started"),
		run: Id,
		stage: Stage,
		task: Schema.NullOr(Id),
		log: Schema.NullOr(Schema.String),
	}),
	/** The run ended, with its stage's answer, what it cost and how long it went. */
	Schema.Struct({
		type: Schema.Literal("ended"),
		run: Id,
		stage: Stage,
		outcome: Outcome,
		usd: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		input: Count,
		output: Count,
		turns: Count,
	}),
	/** The plan stage wrote a plan, or a new version of it. */
	Schema.Struct({
		type: Schema.Literal("planned"),
		version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
		tasks: Schema.Array(Id),
	}),
	/** The build stage pushed commits; `head` is the branch's head after them. */
	Schema.Struct({
		type: Schema.Literal("pushed"),
		head: Sha,
		commits: Schema.Array(Schema.Struct({sha: Sha, title: Title})),
	}),
	/** The review stage judged the criteria at `head`: `met` of `of`, and what it found. */
	Schema.Struct({
		type: Schema.Literal("reviewed"),
		head: Sha,
		met: Count,
		of: Count,
		findings: Schema.Array(Id),
	}),
	/** The watcher saw the ticket's pull request change. Written on a change only. */
	Schema.Struct({
		type: Schema.Literal("pr"),
		url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/)),
		state: PrState,
		head: Sha,
		checks: Schema.Array(Check),
	}),
	/** A stage asks the owner something. `picks`: the buttons, at least one. */
	Schema.Struct({
		type: Schema.Literal("asked"),
		ask: Id,
		what: Title,
		picks: Schema.NonEmptyArray(Title),
	}),
]);
export type CodeFact = typeof CodeFact.Type;

/** The two a person writes in the window, never code. */
export const PersonFact = Schema.Union([
	/**
	 * A person answered an ask: one of its picks, and a note if they wrote one. Never an agent.
	 * `text`: the hash of the ticket's title and body the person saw (./yes.ts), so a yes covers
	 * that text and no edit after it. Missing on an answer written before the hash.
	 */
	Schema.Struct({
		type: Schema.Literal("answered"),
		ask: Id,
		pick: Title,
		note: Body,
		text: Schema.optionalKey(Hash),
	}),
	/** A person rated one of a review's findings. */
	Schema.Struct({
		type: Schema.Literal("rated"),
		finding: Id,
		says: Schema.Literals(["fix", "noise"]),
	}),
]);

/** The nine a lane works with: what code, a stage, the watcher and the person in its box write. */
export const LaneFact = Schema.Union([...CodeFact.members, ...PersonFact.members]);
export type LaneFact = typeof LaneFact.Type;

/** What happened to a ticket. The first fact of every ticket is `filed`, and only the first. */
export const Fact = Schema.Union([...TicketFact.members, ...LaneFact.members]);
export type Fact = typeof Fact.Type;

/** One kind of fact, by its `type`. */
export type FactOf<T extends Fact["type"]> = Extract<Fact, {readonly type: T}>;

/**
 * Who may write each fact. `answered` is a person's: the type holds this table to the ledger
 * door's kinds only a person writes (`PERSON_KINDS`), and the door refuses it from an agent's
 * session. On a ledger with no door (memory, node:sqlite), the line is held twice: the tracker's
 * save refuses to write a person's fact as an agent, `Tickets.write` takes only a `CodeFact`, and
 * the fold keeps one an agent wrote out of every ticket (`step` below). `rated` is a user's too by the note, but the
 * door does not know that kind yet, so the table cannot say `person` for it.
 */
export const WRITTEN_BY = {
	filed: "anyone",
	commented: "anyone",
	closed: "anyone",
	reopened: "anyone",
	started: "anyone",
	ended: "anyone",
	planned: "anyone",
	pushed: "anyone",
	reviewed: "anyone",
	pr: "anyone",
	asked: "anyone",
	answered: "person",
	rated: "anyone",
} as const satisfies Writes<Fact["type"]>;

/** May `by` write a fact of this kind: a person's kind only by a user. */
export const mayWrite = (by: Writer, type: Fact["type"]): boolean =>
	WRITTEN_BY[type] === "anyone" || by.kind === "user";

/** One fact read back: on which ticket, who wrote it, when, and where the ledger put it. */
export const Entry = Schema.Struct({
	pos: Schema.Int,
	ticket: TicketNumber,
	by: Writer,
	/** For an agent's row: the name its person goes by on this ledger, from `door/members`. */
	whose: Schema.optional(Schema.String),
	at: Schema.Finite,
	fact: Fact,
});
export type Entry = typeof Entry.Type;

export const State = Schema.Literals(["open", "closed"]);
export type State = typeof State.Type;

/** A ticket, folded from its entries. `timeline`: every entry, oldest first, `filed` the first. */
export const Ticket = Schema.Struct({
	number: TicketNumber,
	title: Title,
	state: State,
	timeline: Schema.Array(Entry),
});
export type Ticket = typeof Ticket.Type;

/** The name every ticket's streams are under, as the ledger reads a prefix: by whole parts. */
export const ROOT = "tracker/ticket";

/** Ticket `number`'s registered name. Its facts go to the name's inbox. */
export const nameOf = (number: number) => `${ROOT}/${number}`;

const INBOX = /^tracker\/ticket\/([1-9]\d*)\/inbox$/;
const decodeFact = Schema.decodeUnknownOption(Schema.fromJsonString(Fact));

/** What one ledger row is to the tracker: a fact on a ticket, a row of no ticket's facts, or broken. */
export type Read =
	| {readonly kind: "entry"; readonly entry: Entry}
	| {readonly kind: "other"}
	| {readonly kind: "broken"; readonly why: string};

/** Read one row. A row in a ticket's inbox must hold a fact, by a user or an agent; else it is broken. */
export function readRow(row: Row): Read {
	const ticket = INBOX.exec(row.stream)?.[1];
	if (ticket === undefined) return {kind: "other"};
	const broken = (why: string): Read => ({
		kind: "broken",
		why: `row ${row.pos} on #${ticket}: ${why}`,
	});
	const by = writerOf(row.writer);
	if (by === null) return broken(`its writer "${row.writer}" is neither a user nor an agent`);
	const fact = Option.getOrNull(decodeFact(row.data));
	if (fact === null) return broken(`its data is not a fact`);
	if (fact.type !== row.kind) return broken(`a ${fact.type} fact kept as ${row.kind}`);
	return {kind: "entry", entry: {pos: row.pos, ticket: Number(ticket), by, at: row.at, fact}};
}

/** The tickets with the entries folded in, oldest ticket first, and what did not fit, in words. */
export interface Folded {
	readonly tickets: readonly Ticket[];
	readonly problems: readonly string[];
}

const after = (state: State, fact: Fact): State => {
	if (fact.type === "closed") return "closed";
	if (fact.type === "reopened") return "open";
	return state;
};

/** The facts of one kind on a timeline, oldest first. */
export const factsOf = <T extends Fact["type"]>(
	timeline: readonly Entry[],
	type: T,
): readonly FactOf<T>[] =>
	timeline.flatMap((e) => (e.fact.type === type ? [e.fact as FactOf<T>] : []));

/** Why a lane fact does not fit the timeline before it, or `null` when it fits. */
const misfit = (timeline: readonly Entry[], fact: Fact): string | null => {
	switch (fact.type) {
		case "started":
			return factsOf(timeline, "started").some((s) => s.run === fact.run)
				? `run ${fact.run} started a second time`
				: null;
		case "ended": {
			const started = factsOf(timeline, "started").find((s) => s.run === fact.run);
			if (started === undefined) return `run ${fact.run} ended, but it never started`;
			if (started.stage !== fact.stage)
				return `run ${fact.run} started as ${started.stage} and ended as ${fact.stage}`;
			return factsOf(timeline, "ended").some((e) => e.run === fact.run)
				? `run ${fact.run} ended a second time`
				: null;
		}
		case "asked":
			return factsOf(timeline, "asked").some((a) => a.ask === fact.ask)
				? `ask ${fact.ask} asked a second time`
				: null;
		case "answered": {
			// A comment is never an answer, and neither is an answer that does not fit its ask.
			const asked = factsOf(timeline, "asked").find((a) => a.ask === fact.ask);
			if (asked === undefined) return `an answer to ask ${fact.ask}, which was never asked`;
			if (factsOf(timeline, "answered").some((a) => a.ask === fact.ask))
				return `ask ${fact.ask} answered a second time`;
			return asked.picks.includes(fact.pick)
				? null
				: `"${fact.pick}" is not one of ask ${fact.ask}'s picks`;
		}
		default:
			return null;
	}
};

/** One entry onto its ticket: the ticket after it, or why it does not fit. */
const step = (ticket: Ticket | undefined, entry: Entry): Ticket | string => {
	const {fact} = entry;
	const where = `row ${entry.pos} on #${entry.ticket}`;
	// Held here too, not only at the save: an agent's row on a ledger with no door still reads.
	if (!mayWrite(entry.by, fact.type))
		return `${where}: ${fact.type} written by an agent, but only a person writes it`;
	if (fact.type === "filed")
		return ticket === undefined
			? {number: entry.ticket, title: fact.title, state: "open", timeline: [entry]}
			: `${where}: filed a second time`;
	if (ticket === undefined) return `${where}: ${fact.type}, but the ticket was never filed`;
	const wrong = misfit(ticket.timeline, fact);
	if (wrong !== null) return `${where}: ${wrong}`;
	return {...ticket, state: after(ticket.state, fact), timeline: [...ticket.timeline, entry]};
};

/** Fold entries, in the ledger's order, onto the tickets folded so far. */
export function fold(tickets: readonly Ticket[], entries: readonly Entry[]): Folded {
	const byNumber = new Map(tickets.map((t) => [t.number, t]));
	const problems: string[] = [];
	for (const entry of entries) {
		const next = step(byNumber.get(entry.ticket), entry);
		if (typeof next === "string") problems.push(next);
		else byNumber.set(entry.ticket, next);
	}
	return {tickets: [...byNumber.values()].sort((a, b) => a.number - b.number), problems};
}
