import {type Appended, type Fenced, Ledger, type Row, streams} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Duration, Effect, Layer, Schedule, Schema} from "effect";
import {Row as BookRow} from "../criteria/book.ts";
import {LaneId, Owner, PlanId, TaskId, TicketId} from "../ids.ts";
import {Revision} from "../stages/plan/plan.ts";
import {Answer, Attachment} from "./ask.ts";

// The pipeline's facts, kept on the one ledger a tea-host stands on (fabrika's host/ledger.ts): no
// second store. The core's state is a fold over them (./rules.ts), so nothing is kept twice: what
// waits on the owner is worked out from the facts every time.
//
//   planned        a plan was written (a new version of it, when it was there before).
//                  Its tasks and criteria get their ids in the fold, from the plan's criteria book
//   reviewed       a review round of one task of a plan ended, with this many open; or, under
//                  `plan`, a last review or a ship run of the plan's lane did not end it
//   judged         a review's rows on criteria of a plan, each by id and version, at a
//                  commit, and what it found that no criterion covers
//   ruling_needed  sort sent a ticket to the owner to rule on
//   folded         sort found a ticket part of an open plan: the plan covers it from now on, and
//                  its next version is planned with it
//   answered       the owner answered an ask, and the core took the answer
//   built          a build of one task finished, with the files it changed
//   cleared        a listener that holds builds let this one go
//   check_raised   a listener that holds builds asked the owner to look at it
//   shipped        the core sent the build to ship
//   lane           a lane began on a ticket; its id is `L` and the fact's rev in the ticket's inbox
//   released       a lane let its ticket go, under its lease, just before it ended the lease
//
// Who holds a ticket is not a fact here: it is the ledger's lease on the ticket's name
// (./claims.ts), and the ledger's own `claimed` event records each claim.
//
// Where a fact lives. Each plan and each ticket is a registered name under `pipeline/`:
//
//   pipeline/plan/<plan>       planned, folded, judged, reviewed, built, cleared, check_raised,
//                              shipped, and the answers to a plan's asks (plan, stuck, check)
//   pipeline/ticket/<ticket>   ruling_needed and its answer, lane, released
//
// A fact goes in its name's inbox (`<name>/inbox`, open to any writer, one event per message id),
// or, from the holder of the name's lease, in `<name>/facts` under the lease's fence: a lane that
// lost its lease writes nothing there. The fold reads both, in the ledger's order. A fact read back
// from a name that is not its home breaks the read: the ledger is wrong, and nothing is folded.
//
// Only answers the core took are kept. An answer that did not fit is refused before anything is
// written.

export const Fact = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("planned"),
		plan: PlanId,
		tickets: Schema.Array(TicketId),
		/** As written: a task or criterion with no id, or one the book does not hold, gets a new id. */
		data: Revision,
		problems: Schema.Array(Schema.String),
	}),
	/** A review round at one commit: its rows, and what it found that no criterion covers. The fold files both in the plan's book (`withRound`). */
	Schema.Struct({
		type: Schema.Literal("judged"),
		plan: PlanId,
		/** The task the round reviewed, or `plan`: the final round over the whole book. What it found goes under it. */
		task: Owner,
		head: Schema.String,
		proof: Schema.String,
		rows: Schema.Array(BookRow),
		found: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		type: Schema.Literal("reviewed"),
		plan: PlanId,
		/** The task whose list the stall rule counts this in, or `plan`: the last reviews and ship runs of the plan's lane. */
		task: Owner,
		open: Schema.Int,
	}),
	Schema.Struct({
		type: Schema.Literal("ruling_needed"),
		ticket: TicketId,
		ask: Schema.String,
		options: Schema.Array(Schema.String),
		why: Schema.String,
	}),
	/** Sort found `ticket` part of the open plan `plan`. */
	Schema.Struct({type: Schema.Literal("folded"), plan: PlanId, ticket: TicketId}),
	Schema.Struct({type: Schema.Literal("answered"), ...Answer.fields}),
	Schema.Struct({
		type: Schema.Literal("built"),
		plan: PlanId,
		task: TaskId,
		/** The files the build changed. */
		changes: Schema.Array(Schema.String),
		/** How many listeners this build waits on before it ships: each clears it or raises a check. */
		holds: Schema.Int,
	}),
	/** A listener that holds builds says this one needs nothing from it. */
	Schema.Struct({
		type: Schema.Literal("cleared"),
		plan: PlanId,
		task: TaskId,
		build: Schema.Int,
		by: Schema.String,
	}),
	/** A listener that holds builds asks the owner to look at this one. */
	Schema.Struct({
		type: Schema.Literal("check_raised"),
		plan: PlanId,
		task: TaskId,
		build: Schema.Int,
		by: Schema.String,
		question: Schema.String,
		attachments: Schema.Array(Attachment),
	}),
	/** The core sent a build to ship. */
	Schema.Struct({
		type: Schema.Literal("shipped"),
		plan: PlanId,
		task: TaskId,
		build: Schema.Int,
	}),
	/** A lane began on a ticket. Its id is this fact's rev in the ticket's inbox, so two lanes never share one. */
	Schema.Struct({type: Schema.Literal("lane"), ticket: TicketId}),
	/** A lane let its ticket go, written under its lease just before it ended the lease. */
	Schema.Struct({type: Schema.Literal("released"), ticket: TicketId, lane: LaneId}),
]);
export type Fact = typeof Fact.Type;

const FACT_TYPES: ReadonlySet<string> = new Set([
	"planned",
	"judged",
	"reviewed",
	"ruling_needed",
	"folded",
	"answered",
	"built",
	"cleared",
	"check_raised",
	"shipped",
	"lane",
	"released",
] satisfies Fact["type"][]);

/** A fact with its place among the pipeline's facts, from 1. */
export interface Entry {
	readonly seq: number;
	readonly fact: Fact;
}

/** Every pipeline name sits under this one, which is never registered: one prefix read finds all. */
export const ROOT = "pipeline";
export const ticketName = (ticket: TicketId): string => `${ROOT}/ticket/${ticket}`;
export const planName = (plan: PlanId): string => `${ROOT}/plan/${plan}`;
/** The stream only the holder of `name`'s lease writes, under its fence. */
export const factsOf = (name: string): string => `${name}/facts`;

const PLAN_ASK = /^(?:plan|stuck|check):([\w.-]+\/[\w.-]+#[1-9][0-9]*)/;
const TICKET_ASK = /^ruling:([\w.-]+\/[\w.-]+#[1-9][0-9]*)$/;

/** The name a fact lives under. `null`: an answer to an ask whose id names no plan and no ticket. */
export const homeOf = (fact: Fact): string | null => {
	switch (fact.type) {
		case "ruling_needed":
		case "lane":
		case "released":
			return ticketName(fact.ticket);
		case "answered": {
			const plan = PLAN_ASK.exec(fact.id)?.[1];
			if (plan !== undefined) return `${ROOT}/plan/${plan}`;
			const ticket = TICKET_ASK.exec(fact.id)?.[1];
			return ticket === undefined ? null : `${ROOT}/ticket/${ticket}`;
		}
		default:
			return planName(fact.plan);
	}
};

/** The lease a name's holder writes under: the name, and the fence its claim gave. */
export interface Hold {
	readonly name: string;
	readonly fence: number;
}

/** The one ledger, the tea-host's: the pipeline keeps no second one. */
export {Ledger} from "@kampus/fabrika";

const encode = Schema.encodeSync(Fact);
const decode = Schema.decodeUnknownExit(Fact);
const parseJson = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

/** A ledger that does not answer is tried again for about two seconds; after that the pipeline cannot go on. */
export const steady = <A, E extends {readonly _tag: string}, R>(
	what: string,
	e: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, {readonly _tag: "LedgerUnreachable"}>, R> =>
	e.pipe(
		Effect.retry({
			times: 40,
			schedule: Schedule.spaced(Duration.millis(50)),
			while: (x: E) => x._tag === "LedgerUnreachable",
		}),
		Effect.catch((x: E) =>
			x._tag === "LedgerUnreachable"
				? Effect.die(`${what}: the ledger did not answer`)
				: Effect.fail(x as Exclude<E, {readonly _tag: "LedgerUnreachable"}>),
		),
	);

const homeOrDie = (fact: Fact): Effect.Effect<string> => {
	const home = homeOf(fact);
	return home === null
		? Effect.die(`a ${fact.type} fact with no home: ${JSON.stringify(fact)}`)
		: Effect.succeed(home);
};

/** Register `name`. Registered already, it is answered, and nothing is written. */
export const ensureName = (name: string, by: string): Effect.Effect<void, never, Ledger> =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* steady(`register ${name}`, ledger.register(name, by)).pipe(
			Effect.catchTag("Denied", () => Effect.die(`${name} cannot be registered`)),
		);
	});

export interface WriteOptions {
	/** The message id: the same fact sent again under it is answered, and not written twice. Default: a new one. */
	readonly id?: string;
	/** Who writes it, as the ledger records it. Default `pipeline`. */
	readonly by?: string;
}

/**
 * Send a fact to its home's inbox, by anyone: a desk, a stage, a script. Under one message id it is
 * written once, however many times it is sent. With `hold`, only while that lease is live: a lane
 * that lost its lease sends nothing (`Fenced`).
 */
export const sendFact = (
	fact: Fact,
	o: WriteOptions & {readonly hold?: Hold} = {},
): Effect.Effect<Appended, Fenced, Ledger> =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const home = yield* homeOrDie(fact);
		const id = o.id ?? crypto.randomUUID();
		const by = o.by ?? "pipeline";
		const event = {kind: fact.type, writer: by, data: encode(fact)};
		const inbox = streams(home).inbox;
		const send = steady(`send ${fact.type}`, ledger.send(inbox, id, event, o.hold?.fence));
		return yield* send.pipe(
			Effect.catchTag("UnknownName", () => ensureName(home, by).pipe(Effect.andThen(send))),
			Effect.catchTag("UnknownName", () => Effect.die(`${home} was registered, then unknown`)),
			Effect.catchTag("Denied", () => Effect.die(`${inbox} is not an open inbox`)),
		);
	});

/**
 * Write a fact under a lease. At the lease's own name it goes in `<name>/facts`, which only the
 * holder writes; elsewhere in the fact's home inbox, fenced on the lease. Either way a lost lease
 * writes nothing: `Fenced`.
 */
export const appendFact = (
	fact: Fact,
	hold: Hold,
	o: WriteOptions = {},
): Effect.Effect<Appended, Fenced, Ledger> =>
	Effect.gen(function* () {
		const home = yield* homeOrDie(fact);
		if (home !== hold.name) return yield* sendFact(fact, {...o, hold});
		const ledger = yield* Ledger;
		const event = {
			kind: fact.type,
			writer: o.by ?? "pipeline",
			data: encode(fact),
			id: o.id ?? crypto.randomUUID(),
		};
		return yield* steady(
			`append ${fact.type}`,
			ledger.append(factsOf(home), "any", event, hold.fence),
		).pipe(
			Effect.catchTags({
				Stale: () => Effect.die("an append at the end answered stale"),
				Denied: () => Effect.die(`${factsOf(home)} refused its own lease`),
				UnknownName: () => Effect.die(`${home} is held but not registered`),
			}),
		);
	});

/** The name a stream of facts belongs to, or null: the stream holds no facts. */
const nameOfStream = (stream: string): string | null =>
	stream.endsWith("/facts")
		? stream.slice(0, -"/facts".length)
		: stream.endsWith("/inbox")
			? stream.slice(0, -"/inbox".length)
			: null;

/**
 * One row of a fact stream, as a fact. A row that is not a fact, or a fact whose home is not the
 * name it was read from, is a broken ledger: it throws, with where and why.
 */
export const factOfRow = (row: Row): Fact => {
	const name = nameOfStream(row.stream);
	const where = `the ledger at ${row.pos} (${row.stream})`;
	if (name === null) throw new Error(`${where} holds no facts`);
	if (!FACT_TYPES.has(row.kind)) throw new Error(`${where}: a ${row.kind} event is not a fact`);
	const data = parseJson(row.data);
	if (data._tag === "Failure") throw new Error(`${where}: its data is not JSON`);
	const fact = decode(data.value);
	if (fact._tag === "Failure") throw new Error(`${where}: not a ${row.kind} fact`);
	if (fact.value.type !== row.kind)
		throw new Error(`${where}: a ${fact.value.type} fact written as ${row.kind}`);
	const home = homeOf(fact.value);
	if (home !== name) throw new Error(`${where}: a fact of ${home ?? "no name"} read from ${name}`);
	return fact.value;
};

const PAGE = 1000;

/**
 * Every pipeline fact, oldest first, each with its place among them. A row that breaks
 * `factOfRow` ends the read with a defect: nothing is folded from a broken ledger.
 */
export const readFacts: Effect.Effect<readonly Entry[], never, Ledger> = Effect.gen(function* () {
	const ledger = yield* Ledger;
	const out: Entry[] = [];
	let from = 0;
	for (;;) {
		const page = yield* steady("read the facts", ledger.read(from, PAGE, ROOT));
		for (const row of page) {
			if (nameOfStream(row.stream) === null) continue;
			// A throw here is a defect: the ledger is broken, and the read ends.
			out.push({seq: out.length + 1, fact: yield* Effect.sync(() => factOfRow(row))});
		}
		if (page.length < PAGE) return out;
		from = page.at(-1)?.pos ?? from;
	}
});

/**
 * A ledger in memory, starting with `facts`, for tests and the demo desk. Every layer made from
 * one `memoryLedger` shares it, as two processes share one ledger; each process keeps its own
 * leases' renewals (./claims.ts). `read` and `rows` read it as it is now.
 */
export function memoryLedger(facts: readonly Fact[] = []) {
	const service = memoryService();
	const layer = Layer.succeed(Ledger, service);
	const now = <A, E>(e: Effect.Effect<A, E, Ledger>) =>
		Effect.runSync(Effect.orDie(Effect.provideService(e, Ledger, service)));
	for (const fact of facts) now(sendFact(fact));
	return {
		layer,
		service,
		/** Every fact, oldest first, as `readFacts` reads them. */
		read: (): readonly Entry[] => now(readFacts),
		/** Every row under `pipeline/`: the ledger's own (registrations, claims) with the facts. */
		rows: (): readonly Row[] => now(service.read(0, 1_000_000, ROOT)),
	};
}
