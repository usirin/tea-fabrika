// Sort on tea-host (experiment 111): the sort machine, unchanged, under `sort:<n>`. Its sorter runs
// in the child `sort:<n>:agent`, one ask per try, under an id made of the try's run and its prompt.
// A try asked again after a takeover is answered from the ledger: every try is a whole prompt in a
// new conversation (../stages/sort/brief.ts), so an answer from the dead host's try is as good as a
// new one, and the agent does not run again.
//
// Every write the answer makes goes through `Idempotency` with its own key:
//
//   comment   on the ticket, with the key's marker; after a death between rows, the marker is read
//   label     on the ticket; the label is read
//   close     the ticket, as a duplicate or not planned; its state is read
//   link      a comment on the plan's ticket, with the key's marker
//   ruling    a `ruling_needed` fact on the ledger, sent under the key as its message id, so a second
//             send is answered and not written again
//   fold      a `folded` fact on the plan, sent the same way

import {Ledger, type Self} from "@kampus/fabrika";
import type {DraftRun} from "@kampus/fabrika/agents/claude";
import {Effect, Exit, Option, Schema, Stream} from "effect";
import {type Fact, sendFact} from "../asks/ledger.ts";
import {planOf, readTicketId} from "../ids.ts";
import {nameOf} from "../stages/outcome.ts";
import {saidOf} from "../stages/sort/answer.ts";
import {sortReadInterpret, sortSubscribe, sortWriteInterpret} from "../stages/sort/handlers.ts";
import {type SortMachineMsg, type SortState, sort} from "../stages/sort/machine.ts";
import {
	Settings,
	Sorter,
	type SortHost,
	type SortMsg,
	type SortPlans,
	type SortWrite,
	SortWrites,
} from "../stages/sort/services.ts";
import {type AgentAsk, agentOf, askAgent, asWritten, digest, type Turn} from "./agent.ts";
import {Idempotency, useKey} from "./idempotency.ts";
import {Issues} from "./issues.ts";
import {jsonJournal, type Stage} from "./stage.ts";

export const SortJob = Schema.Struct({
	ticket: Schema.String,
	tries: Schema.Finite,
	settings: Settings,
	/** The child's dollar cap: its `limits` on the child spec. */
	usd: Schema.Finite,
});
export type SortJob = typeof SortJob.Type;

/** The registered name of one ticket's sort. */
export const sortName = (number: number) => `sort:${number}`;

const Run = Schema.Struct({
	key: Schema.String,
	id: Schema.String,
	prompt: Schema.String,
	session: Schema.Struct({id: Schema.String, continues: Schema.Boolean}),
	agent: Schema.NullOr(Schema.String),
	folder: Schema.NullOr(Schema.String),
});
const SortAskBody = Schema.Struct({run: Run, settings: Settings});
const readAsk = Schema.decodeUnknownExit(SortAskBody);

/** A sorter Msg moved onto the run that asked now. */
const onRun =
	(run: DraftRun) =>
	(m: SortMsg): SortMsg => ({...m, key: run.key, id: run.id});

/** The stage's `Sorter`: one ask per try to its child, the answer replayed onto the current run. */
export const childSorter = (child: string) =>
	Effect.gen(function* () {
		const context = yield* Effect.context<Self | Ledger>();
		return Sorter.of({
			run: (run, settings) =>
				Stream.unwrap(
					askAgent(
						child,
						`sort/${run.id}/${digest(run.prompt)}`,
						{run, settings},
						asWritten<readonly SortMsg[]>(),
					).pipe(
						Effect.map((asked) =>
							asked.how === "answered"
								? Stream.fromIterable<SortMsg>(asked.answer).pipe(Stream.map(onRun(run)))
								: Stream.succeed<SortMsg>({
										type: "sort_failed",
										key: run.key,
										id: run.id,
										error: "error_max_budget_usd: the agent child reached its limit",
										spend: {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0},
									}),
						),
						Effect.provideContext(context),
					),
				),
		});
	});

/** The child's turn: the real `Sorter` (live or scripted) on one try, its stream read to its end. */
export const sortTurn =
	(agent: Turn["agent"]) =>
	(ask: AgentAsk): Effect.Effect<Turn, never, Sorter> =>
		Effect.gen(function* () {
			const read = readAsk(ask.brief);
			if (Exit.isFailure(read))
				return yield* Effect.die(`a sort ask that does not read: ${ask.id}`);
			const msgs = Array.from(
				yield* (yield* Sorter).run(read.value.run, read.value.settings).pipe(
					Stream.takeUntil((m) => m.type !== "sort_tool"),
					Stream.runCollect,
				),
			);
			const usd = msgs.reduce((n, m) => n + (m.type === "sort_tool" ? 0 : m.spend.costUsd), 0);
			const tokens = msgs.reduce((n, m) => n + (m.type === "sort_tool" ? 0 : m.spend.tokens), 0);
			return {answer: msgs, cost: {usd, tokens}, agent};
		});

const found = (there: boolean) => (there ? Option.some(null) : Option.none());

/** `SortWrites` whose every write goes out once, under this lease's gate. */
export const sortWritesOf = (
	gate: Idempotency["Service"],
	issues: Issues["Service"],
	context: {readonly ledger: Ledger["Service"]; readonly by: string},
): SortWrites["Service"] => {
	const once = (write: SortWrite) => {
		switch (write.op) {
			case "comment":
				return gate.once({
					op: "comment",
					subject: write.ticket,
					answer: Schema.Null,
					look: (key) => issues.hasComment(write.ticket, key).pipe(Effect.map(found)),
					send: (key) => issues.comment(key, write.ticket, write.body).pipe(Effect.as(null)),
				});
			case "label":
				return gate.once({
					op: "label",
					subject: `${write.ticket}:${write.label}`,
					answer: Schema.Null,
					look: () =>
						issues.labels(write.ticket).pipe(Effect.map((ls) => found(ls.includes(write.label)))),
					send: (key) => issues.label(key, write.ticket, write.label).pipe(Effect.as(null)),
				});
			case "close":
				return gate.once({
					op: "close",
					subject: write.ticket,
					answer: Schema.Null,
					look: () => issues.closed(write.ticket).pipe(Effect.map(found)),
					send: (key) => issues.close(key, write.ticket, write.reason).pipe(Effect.as(null)),
				});
			case "link":
				return gate.once({
					op: "link",
					subject: write.plan,
					answer: Schema.Null,
					look: (key) => issues.hasComment(write.plan, key).pipe(Effect.map(found)),
					send: (key) => issues.comment(key, write.plan, write.body).pipe(Effect.as(null)),
				});
			case "ruling": {
				const ticket = readTicketId(write.ticket);
				if (ticket === null) return Effect.fail({_tag: "unknown" as const});
				return fact("ruling", write.ticket, {
					type: "ruling_needed",
					ticket,
					ask: write.ask,
					options: write.options,
					why: write.why,
				});
			}
			case "fold": {
				const plan = readTicketId(write.plan);
				const ticket = readTicketId(write.ticket);
				if (plan === null || ticket === null) return Effect.fail({_tag: "unknown" as const});
				return fact("fold", `${write.plan}:${write.ticket}`, {
					type: "folded",
					plan: planOf(plan),
					ticket,
				});
			}
		}
	};
	/** A fact on the ledger, once: its message id is the key, so a second send is answered, not written. */
	const fact = (op: string, subject: string, f: Fact) =>
		gate.once({
			op,
			subject,
			answer: Schema.Null,
			look: () => Effect.succeed(Option.none()),
			send: (key) =>
				useKey(key).pipe(
					Effect.flatMap((text) => sendFact(f, {id: text, by: context.by})),
					Effect.provideService(Ledger, context.ledger),
					Effect.mapError(() => ({_tag: "unknown" as const})),
					Effect.as(null),
				),
		});
	return SortWrites.of({write: (write) => once(write)});
};

export const hostedSort: Stage<
	SortState,
	SortMachineMsg,
	SortJob,
	SortHost | SortPlans | Issues | Idempotency | Self | Ledger
> = {
	kind: "sort",
	job: SortJob,
	boot: (self) =>
		Effect.gen(function* () {
			const sorter = yield* childSorter(agentOf(self.name));
			const writes = sortWritesOf(yield* Idempotency, yield* Issues, {
				ledger: yield* Ledger,
				by: self.name,
			});
			return yield* self
				.run(
					sort,
					{schema: jsonJournal<SortState>(), cursor: () => 0},
					{
						ctx: undefined,
						interpret: {...sortReadInterpret, ...sortWriteInterpret()},
						subscribe: sortSubscribe,
						terminal: (s: SortState) => s.phase === "over",
					},
				)
				.pipe(Effect.provideService(Sorter, sorter), Effect.provideService(SortWrites, writes));
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	// The conversation's name is the stage's: the same on every host, so a try's run id is too.
	start: (job, name) => ({
		type: "start",
		ask: {ticket: job.ticket, tries: job.tries},
		settings: job.settings,
		key: name,
	}),
	resume: {type: "resume"},
	finish: (end) =>
		Effect.succeed(
			end.phase !== "over"
				? null
				: {
						name: nameOf(end.outcome),
						outcome: end.outcome,
						said: end.report.answer === null ? null : saidOf(end.report.answer),
						answer: end.report.answer,
						tries: end.report.tries,
						wrote: end.report.wrote.map((w) => w.op),
					},
		),
	agent: (job) => ({usd: job.usd}),
};
