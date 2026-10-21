// Experiment 101's answerer: experiment 98's (../98-tea-host-package/answerer.ts), with a real
// agent and a record of the run in flight (./machine.ts). Per question, in inbox order:
//
//   answer on record        repeat it (98)
//   planFor says recover    the dead owner's run finished; its answer is in the record: use it
//   planFor says resume     fork the dead owner's session from the transcript in the record, and
//                           send only the turns still to do
//   fresh                   a new session, both turns
//
// A run is saved as `started` (its session id) BEFORE it starts, each turn's result as `turned`
// before the next turn is sent, and in resume mode its transcript as `progress`, line by line:
// the Agent SDK's `SessionStore`, written into this program's own state stream. All of it through
// `self.run`, so every write is fenced on this host's lease.
//
// MODE=fresh records `started` and `turned` (for the count) but keeps no transcript and never
// reads the record: today's behaviour, the baseline.
//
// CRASH_AFTER=q-15 with a marker folder (MARKS): the first host to finish q-15's run kills its own
// process (SIGKILL) after the run's answer is on record as a turn and before the answer is saved:
// the window experiment 98 found, hit on purpose (FoundationDB's buggify), once in the whole run.
import {randomUUID} from "node:crypto";
import {existsSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import type {SessionKey, SessionStore, SessionStoreEntry} from "@anthropic-ai/claude-agent-sdk";
import {defineProgram, envelope, inboxOf, input, Self, streams} from "@kampus/fabrika";
import {Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";
import {Question} from "../98-tea-host-package/answerer.ts";
import {CHECK, runTurns} from "./agent.ts";
import {type AnswerCmd, AnswererState, answerer, type Entry, planFor} from "./machine.ts";

export interface AnswererSettings {
	readonly mode: "fresh" | "resume";
	readonly model: string;
	readonly crashAfter: string | null;
	/** A folder every answerer host shares, for the crash's once-only marker. */
	readonly marks: string | null;
}

const Saved = Schema.fromJsonString(Schema.Struct({state: AnswererState}));
const decodeSaved = Schema.decodeUnknownExit(Saved);

/** The turns of one whole run. */
const promptsOf = (text: string) => [text, CHECK] as const;
/** Claude Code's cost counter, saved in a transcript at the end of a query(): left out of a load. */
const COST_STATE = "cost-state";

export const answererProgram = (
	settings: AnswererSettings,
	line: (o: object) => Effect.Effect<void>,
) =>
	defineProgram({
		name: "answerer",
		description:
			"Answers each question once per call id with a real agent, recording each agent run before it starts so a new owner can recover or resume it.",
		inputs: {inbox: input(envelope(Question), "One question: call id, reply-to, text.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				const states = yield* self.reads
					.readStream(streams(self.name).state)
					.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);
				const known = new Map<string, string>();
				for (const r of states) {
					const exit = decodeSaved(r.data);
					const last = Exit.isSuccess(exit) ? exit.value.state.last : null;
					if (last !== null) known.set(last.id, last.answer);
				}
				const replies = new Map<string, number>();
				const reply = (cmd: AnswerCmd) =>
					Effect.gen(function* () {
						const to = inboxOf(cmd.to);
						if (to === null) return yield* line({ev: "reply", id: cmd.id, how: "not an inbox"});
						const k = (replies.get(cmd.id) ?? 0) + 1;
						replies.set(cmd.id, k);
						const sent = yield* self.send(to, `${cmd.id}@${self.fence}#${k}`, {
							id: cmd.id,
							corr: cmd.corr,
							answer: cmd.answer,
							fence: self.fence,
						});
						yield* line({ev: "reply", id: cmd.id, how: sent.how});
					});
				const handle = yield* self.run(
					answerer,
					{schema: AnswererState, cursor: (s) => s.cursor},
					{ctx: undefined, interpret: {reply}},
				);
				const machine = yield* handle.ready;
				const inflight = machine.getState().inflight;
				yield* line({
					ev: "known",
					known: known.size,
					inflight:
						inflight === null
							? null
							: {
									id: inflight.id,
									runs: inflight.runs.length,
									sessions: inflight.runs.map((r) => r.session),
								},
				});

				/** The SDK's store, in this program's state: one per run, keyed by session. */
				const storeFor = (id: string) => {
					let assistants = 0;
					const waiting: {n: number; done: () => void}[] = [];
					const store: SessionStore = {
						append: async (key: SessionKey, entries: SessionStoreEntry[]) => {
							if (key.subpath !== undefined) return;
							await Effect.runPromise(
								machine.dispatch({
									type: "progress",
									id,
									session: key.sessionId,
									entries: entries as Entry[],
								}),
							);
							assistants += entries.filter((e) => e.type === "assistant").length;
							for (const w of waiting.filter((x) => assistants >= x.n)) w.done();
						},
						load: async (key: SessionKey) => {
							if (key.subpath !== undefined) return null;
							const run = machine
								.getState()
								.inflight?.runs.find((r) => r.session === key.sessionId);
							return run === undefined
								? null
								: run.entries.flatMap((e): SessionStoreEntry[] =>
										typeof e.type === "string" && e.type !== COST_STATE
											? [{...e, type: e.type}]
											: [],
									);
						},
					};
					/** Resolves once `n` assistant lines are on record, or after 3 s. */
					const caughtUp = (n: number) =>
						assistants >= n
							? Promise.resolve()
							: new Promise<void>((done) => {
									waiting.push({n, done});
									setTimeout(done, 3000);
								});
					return {store, caughtUp};
				};

				yield* inputs.inbox.pipe(
					Stream.runForEach((e) =>
						Effect.gen(function* () {
							if (e.rev <= machine.getState().cursor) return;
							const q = e.body;
							const asked = {id: q.id, corr: q.corr, replyTo: q.replyTo, rev: e.rev};
							const had = known.get(q.id);
							if (had !== undefined) {
								yield* line({ev: "repeat", id: q.id, rev: e.rev});
								return yield* machine.dispatch({type: "repeat", ...asked, answer: had});
							}
							const prompts = promptsOf(q.text);
							const plan = planFor(
								machine.getState(),
								q.id,
								settings.mode === "resume",
								prompts.length,
							);
							if (plan.how === "recover") {
								yield* line({
									ev: "think",
									id: q.id,
									rev: e.rev,
									how: "recover",
									usd: 0,
									ms: 0,
									from: plan.session,
								});
								yield* machine.dispatch({type: "answered", ...asked, answer: plan.answer});
								known.set(q.id, plan.answer);
								return;
							}
							const done = plan.how === "resume" ? plan.done : 0;
							const from = plan.how === "resume" ? plan.from : null;
							const session = randomUUID();
							// The run is on record before it starts: a new owner knows it was asked.
							yield* machine.dispatch({type: "started", id: q.id, rev: e.rev, session, from});
							yield* line({ev: "ask", id: q.id, rev: e.rev, how: plan.how, session, from, done});
							const kept = settings.mode === "resume" ? storeFor(q.id) : null;
							const t0 = Date.now();
							const thought = yield* runTurns({
								model: settings.model,
								session,
								from,
								prompts: prompts.slice(done),
								store: kept?.store ?? null,
								onTurn: async (r) => {
									const turn = done + r.turn;
									// A turn is done once its transcript is on record too: a resume needs it.
									// A forked run's copy of the history holds the earlier turns' lines.
									if (kept !== null && r.ok) await kept.caughtUp(turn);
									await Effect.runPromise(
										machine.dispatch({
											type: "turned",
											id: q.id,
											session,
											turn: {turn, ok: r.ok, text: r.text, totalUsd: r.totalUsd},
										}),
									);
									await Effect.runPromise(
										line({
											ev: "turn",
											id: q.id,
											session,
											turn,
											ok: r.ok,
											usd: r.totalUsd,
											ms: r.ms,
											tokens: {
												in: r.inputTokens,
												out: r.outputTokens,
												cacheRead: r.cacheReadTokens,
												cacheWrite: r.cacheWriteTokens,
											},
										}),
									);
								},
							});
							yield* line({
								ev: "think",
								id: q.id,
								rev: e.rev,
								how: plan.how,
								session,
								ok: thought.ok,
								turns: thought.turns.length,
								usd: thought.totalUsd,
								ms: Date.now() - t0,
							});
							if (settings.crashAfter === q.id && settings.marks !== null) {
								const mark = join(settings.marks, "crashed");
								if (!existsSync(mark)) {
									// Node at the edge: the once-only marker, then this process's own SIGKILL.
									writeFileSync(mark, `${self.holder}\n`);
									yield* line({ev: "crash", id: q.id, session});
									process.kill(process.pid, "SIGKILL");
									return yield* Effect.never;
								}
							}
							yield* machine.dispatch({type: "answered", ...asked, answer: thought.answer});
							known.set(q.id, thought.answer);
						}),
					),
				);
			}).pipe(Effect.scoped),
	});
