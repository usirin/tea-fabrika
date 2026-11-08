// The program runner, next/: one process's turns (Tier 1, P11). Under one permit a turn catches
// the process up on its inbox, finds a resend, steps the fresh input purely, saves that it is
// about to append, appends through the door's checked writer, folds what landed and installs it.
// Only then do its Cmds run, each saved as dispatched first, each answer saved as a letter before
// the program sees it. A wake folds saved letters and runs none of their Cmds.
import {applyCell, type Outcome} from "@demlik/tea";
import {
	Cause,
	Clock,
	Context,
	DateTime,
	Effect,
	Layer,
	Option,
	Result,
	Schema,
	Semaphore,
	Stream,
	Tracer,
} from "effect";
import {
	Activity,
	Dead,
	type Appended,
	type Archive,
	type From,
	type History,
	LedgerError,
	Mailbox,
	MemberFact,
	NotGranted,
	ParentText,
	type Placed,
	ProcessFact,
	ProcessStore,
	ProcessManager,
	type ProcessError,
	RecoveryStore,
	Start,
	type RecordManager,
	RuntimeRecord,
	SessionManager,
	SigningRefused,
	SignRequest,
	type SinkError,
	type Sql,
	type Writer,
} from "../coordination/index.ts";
import {Failure, Policy, Recovery, type Supervision} from "../coordination/recovery.ts";
import {
	Alarm,
	CheckedWriter,
	type Fact,
	Incoming,
	type Loaded,
	ProgramLoader,
	Recording,
	type View,
	WatcherManager,
} from "./entry.ts";
import {diff} from "./patch.ts";
import {ProgramDown, Refusal, type Step, Write} from "./program.ts";
import {Saved} from "./state.ts";
import {defaultPolicy, supervisor, type SupervisorMsg} from "./supervisor.ts";

/** What `msg` answers: the input's placing in the inbox, or why it was not taken. */
export const Sent = Schema.TaggedUnion({
	accepted: {rev: Schema.Int, pos: Schema.Int},
	refused: Refusal.fields,
});
export type Sent = typeof Sent.Type;

/** What `open` answers: the inbox position the view was made at, and the view. */
export type Opened = {readonly rev: number; readonly view: View};

/** The process a runner steps: its id, its registered name (its inbox), its program, the build of
 *  the code stepping it, and its checked owner, the writer of its own writes. */
export type Descriptor = {
	readonly id: string;
	readonly name: string;
	readonly program: string;
	readonly build: string;
	readonly owner: Writer;
};

/** A Cmd the runner has saved as dispatched and not yet seen answered. Its id is stable: the
 *  process, the inbox position of the letter whose step made it, and its index there. */
const Dispatched = Schema.Struct({
	id: Schema.NonEmptyString,
	cmd: Schema.Json,
	state: Schema.Literal("dispatched"),
	parent: Schema.NullOr(ParentText),
	traceId: Schema.String,
	build: Schema.String,
});
type Dispatched = typeof Dispatched.Type;
const decodeDispatched = Schema.decodeUnknownSync(Schema.Array(Dispatched));

/** The turn a crash may cut: an input stepped and about to be appended. */
const Turn = Schema.TaggedUnion({prepared: {id: Schema.NonEmptyString}});

/** The runtime's own facts and lifecycle facts a program may never write, even if declared. */
const RESERVED = new Set([
	...Object.keys(ProcessFact.cases),
	...Object.keys(MemberFact.cases),
	...Object.keys(RuntimeRecord.cases),
]);

/** The Cmd the runner itself performs: a checked write, signed for its parent or the owner. */
const WRITE = "write";
const WriteCmd = Schema.Struct({stream: Schema.NonEmptyString, write: Write});
const decodeWriteCmd = Schema.decodeUnknownResult(WriteCmd);
const decodeIncoming = Schema.decodeUnknownEffect(Incoming);
const Typed = Schema.Struct({type: Schema.String});
const decodeTyped = Schema.decodeUnknownOption(Typed);

const PROCESS = "fab.process";
const tag = (word: string): string => `fab.runner.${word}`;

/** What a process holds between turns. */
type Live = {
	readonly loaded: Loaded;
	readonly model: unknown;
	readonly view: unknown;
	readonly wake: number | null;
	readonly v: number;
	/** The last inbox rev folded, and that letter's inbox position. */
	readonly after: number;
	readonly pos: number;
	readonly cmds: ReadonlyArray<Dispatched>;
};

/** A failed Cmd's settled Msg error: its case is its why. */
const failure = (why: string) => Schema.TaggedStruct(why, {}).make({});

export class ProgramRunner extends Context.Service<
	ProgramRunner,
	{
		/** Registers a watcher and answers the current view. */
		readonly open: (client: string) => Effect.Effect<Opened, RunnerFailure>;
		/** Takes one delivered input: P10's internal delivery, never a public request. */
		readonly msg: (input: unknown) => Effect.Effect<Sent, RunnerFailure>;
		/** The object's alarm fired at `at`: the program's timer, if it asked for one by then. */
		readonly due: (at: number) => Effect.Effect<void, RunnerFailure>;
		readonly restart: (request: {
			readonly id: string;
			readonly build: string;
		}) => Effect.Effect<void, RunnerFailure>;
	}
>()("@kampus/libfabrika/ProgramRunner") {
	static readonly layer = (
		initial: Descriptor,
		options?: {
			readonly policy?: Policy;
			readonly recovery: {readonly sql: Sql; readonly name: string; readonly capacity: number};
			readonly fault?: (cut: string) => Effect.Effect<void, LedgerError>;
		},
	): Layer.Layer<
		ProgramRunner,
		never,
		ProgramLoader | ProcessStore | Mailbox | CheckedWriter | WatcherManager | Alarm | Recording
	> =>
		Layer.effect(
			ProgramRunner,
			Effect.gen(function* () {
				const loader = yield* ProgramLoader;
				const rootStore = yield* ProcessStore;
				let store = rootStore;
				let process = initial;
				const manager = yield* Effect.serviceOption(ProcessManager);
				const recovery =
					options === undefined
						? null
						: yield* RecoveryStore.pipe(
								Effect.provide(RecoveryStore.layer(options.recovery.sql, options.recovery)),
							);
				let supervision: Supervision | null = null;
				let woke = false;
				const mailbox = yield* Mailbox;
				const checked = yield* CheckedWriter;
				const watchers = yield* WatcherManager;
				const alarm = yield* Alarm;
				const recording = yield* Recording;
				const sessions = yield* Effect.serviceOption(SessionManager);
				// Recording's flush reads the object's record and archive services; they are in the
				// context this runner is built in whenever the real sink is wired (P12, P37).
				const built = yield* Effect.context<never>();
				const flushed = recording.flush.pipe(
					Effect.provideContext(built as Context.Context<RecordManager | Archive>),
				);
				const permit = yield* Semaphore.make(1);
				let live: Live | null = null;
				/** Writes left dispatched by an earlier process life: retried once loaded. */
				let retry: ReadonlyArray<Dispatched> = [];
				const clients = new Set<string>();

				const now = Effect.map(DateTime.now, DateTime.formatIso);
				/** The current trace: every runner call runs inside its own span. */
				const traceId = Effect.currentSpan.pipe(
					Effect.map((span) => span.traceId),
					Effect.orDie,
				);
				const from = Effect.fnUntraced(function* (parent: string | null, traceId: string) {
					return {
						by: process.owner.key,
						for: process.owner.for,
						sentAt: yield* now,
						seen: 0,
						parent,
						traceId,
						build: process.build,
					} satisfies From;
				});

				const fault = (cut: string) => options?.fault?.(cut) ?? Effect.void;
				const coordinator = Effect.gen(function* () {
					if (Option.isNone(manager)) return yield* new LedgerError({why: "unreachable"});
					return manager.value;
				});
				const saveRecovery = Effect.fnUntraced(function* (next: Supervision) {
					if (recovery !== null) yield* recovery.save(next);
					supervision = next;
				});
				const currentRecovery = Effect.suspend(() =>
					supervision === null
						? Effect.fail(new LedgerError({why: "bad_row"}))
						: Effect.succeed(supervision),
				);
				const moved = (s: Supervision, msg: SupervisorMsg): Supervision =>
					applyCell(supervisor, s, msg)[0];
				const adopt = Effect.fnUntraced(function* (id: string, build: string) {
					if (process.id === id && process.build === build) return;
					store = yield* rootStore.select(id);
					process = {...process, id, build};
					live = null;
					retry = [];
				});
				const resume = Effect.fnUntraced(function* () {
					while (supervision !== null && supervision.pending !== null) {
						const s: Supervision = supervision;
						const action = s.pending;
						if (action === null) break;
						const p = yield* coordinator;
						const meta = action.from ?? (yield* from(null, yield* traceId));
						switch (action.type) {
							case "dead": {
								const receipt = s.receipts.find(
									(r) => r.process === action.process && r.result !== null,
								);
								if (receipt === undefined) return yield* new LedgerError({why: "bad_row"});
								yield* p
									.dead(
										action.process,
										Dead.make({
											tries: receipt.tries,
											limit: s.policy.maxDeliveries,
											m: receipt.letter,
											build: s.build,
											errors: receipt.errors,
										}),
										meta,
									)
									.pipe(
										Effect.withSpan("runner.dead", {
											attributes: {
												[PROCESS]: action.process,
												[tag("letter")]: receipt.letter,
												[tag("attempt")]: receipt.tries,
												[tag("build")]: s.build,
											},
										}),
									);
								yield* fault("after_dead");
								yield* saveRecovery({...s, pending: {...action, type: "exit"}});
								break;
							}
							case "exit": {
								if (s.recovery._tag !== "ending") return yield* new LedgerError({why: "bad_row"});
								const why =
									s.restart !== undefined
										? "restart"
										: s.recovery.failure._tag === "saved"
											? "saved_letter"
											: s.recovery.failure._tag === "fresh"
												? "step"
												: "interrupted";
								yield* p.exit(action.process, why, meta);
								yield* fault("after_exit");
								const status = yield* p.status(process.name);
								if (s.restart !== undefined) {
									const request = Start.cases.again.make({
										id: s.restart.id,
										name: s.name,
										after: action.process,
										why: "restart",
										code: {program: process.program, hash: s.restart.build},
									});
									yield* saveRecovery({
										...s,
										build: s.restart.build,
										recovery: Recovery.cases.starting.make({after: action.process, request}),
										pending: {type: "start", process: action.process, from: meta},
									});
								} else {
									const next = moved(
										{...s, restarts: status.restarts},
										{type: "exited", at: status.at},
									);
									yield* saveRecovery({
										...next,
										pending: next.pending === null ? null : {...next.pending, from: meta},
									});
								}
								live = null;
								retry = [];
								break;
							}
							case "down": {
								if (s.recovery._tag !== "down") return yield* new LedgerError({why: "bad_row"});
								yield* p.down(action.process, s.recovery, meta);
								yield* fault("after_down");
								yield* alarm.set(s.recovery.until);
								yield* saveRecovery({...s, pending: null});
								break;
							}
							case "start": {
								if (s.recovery._tag !== "starting") return yield* new LedgerError({why: "bad_row"});
								const status = yield* p.status(s.name);
								const started = yield* p.start(s.recovery.request, meta).pipe(
									Effect.withSpan("runner.restart", {
										attributes: {
											[PROCESS]: action.process,
											[tag("until")]: action.until ?? status.at,
											[tag("lag")]: Math.max(0, status.at - (action.until ?? status.at)),
											[tag("build")]: s.build,
											[tag("crashes")]: s.crashes ?? 0,
										},
									}),
								);
								yield* fault("after_start");
								yield* saveRecovery({
									...s,
									pending: {
										...action,
										type: "checkpoint",
										after: action.process,
										process: started.process,
									},
								});
								break;
							}
							case "checkpoint": {
								if (action.after === undefined) return yield* new LedgerError({why: "bad_row"});
								const previous = yield* rootStore.select(action.after);
								const next = yield* rootStore.select(action.process);
								if (s.restart === undefined && (yield* next.load) === null) {
									const checkpoint = yield* previous.load;
									if (checkpoint !== null) yield* next.save({...checkpoint, turn: null, cmds: []});
								}
								yield* fault("after_checkpoint");
								const status = yield* p.status(s.name);
								const {restart: _restart, ...kept} = s;
								const requests =
									s.restart === undefined
										? s.requests
										: [...(s.requests ?? []), {...s.restart, process: action.process}];
								yield* saveRecovery({
									...moved(kept, {type: "started", process: action.process, at: status.at}),
									restarts: status.restarts,
									...(requests === undefined ? {} : {requests}),
								});
								yield* adopt(action.process, s.build);
								break;
							}
						}
					}
				});
				const continueRecovery = Effect.fnUntraced(function* () {
					yield* resume().pipe(
						Effect.onError(() =>
							Effect.gen(function* () {
								if (supervision?.pending === null || supervision === null) return;
								const at = yield* Clock.currentTimeMillis;
								yield* alarm.set(at + supervision.policy.backoff.minMs);
							}),
						),
					);
				});
				const observed = Effect.fnUntraced(function* (
					failure: Failure,
					at: number,
					original?: unknown,
				) {
					if (supervision === null) return;
					const s = supervision;
					const meta = yield* from(null, yield* traceId);
					let next = moved(s, {type: "threw", failure, at});
					const observations = [
						...s.observations,
						{
							seq: failure.seq,
							process: failure.process,
							letter: failure.letter,
							phase: failure._tag,
							at,
							...(failure._tag === "interrupted" ? {} : {error: failure.error}),
						},
					];
					next = {
						...next,
						observations,
						pending: next.pending === null ? null : {...next.pending, from: meta},
					};
					if (failure._tag === "fresh") {
						const old = s.receipts.find((r) => r.letter === failure.letter);
						if (old === undefined || next.pending === null)
							return yield* new LedgerError({why: "bad_row"});
						const errors = [...old.errors, failure.error];
						const terminal = errors.length >= s.policy.maxDeliveries;
						const receipt = {
							...old,
							errors,
							tries: errors.length,
							process: failure.process,
							result: terminal
								? Schema.TaggedStruct("refused", {why: Schema.Literal("dead")}).make({why: "dead"})
								: null,
						};
						next = {
							...next,
							receipts: s.receipts.map((r) => (r.letter === failure.letter ? receipt : r)),
							pending: {...next.pending, type: terminal ? "dead" : "exit"},
						};
					}
					yield* saveRecovery(next);
					if (failure._tag !== "interrupted")
						yield* Effect.exit(
							Effect.fail(original).pipe(
								Effect.withSpan("runner.throw", {
									attributes: {
										[PROCESS]: failure.process,
										"error.type": failure.error,
										[tag("letter")]: failure.letter,
										[tag("build")]: failure.build,
										[tag("phase")]: failure._tag,
										[tag("attempt")]: failure.seq,
									},
								}),
							),
						);
					yield* fault("after_observation");
					yield* store.activity(Activity.cases.idle.make({process: failure.process}));
					yield* continueRecovery();
				});
				const ensure = Effect.fnUntraced(function* (time?: number) {
					if (recovery === null) return;
					const p = yield* coordinator;
					const status = yield* p.status(initial.name);
					if (supervision === null) {
						const policy = yield* Effect.try({
							try: () => Schema.decodeUnknownSync(Policy)(options?.policy ?? defaultPolicy),
							catch: () => new LedgerError({why: "bad_row"}),
						});
						supervision = yield* recovery.load;
						if (supervision === null)
							supervision = supervisor.init(null, {
								policy,
								process: status.state.process,
								name: initial.name,
								build: status.state.code.hash,
								at: status.at,
							})[0];
					}
					const s = supervision;
					if (
						status.state._tag === "live" &&
						s.recovery._tag === "down" &&
						status.state.process !== s.recovery.process
					) {
						yield* saveRecovery({
							...moved(s, {type: "started", process: status.state.process, at: status.at}),
							restarts: status.restarts,
						});
					}
					yield* continueRecovery();
					const resumed = yield* currentRecovery;
					if (resumed.recovery._tag === "live")
						yield* adopt(resumed.recovery.process, resumed.build);
					if (!woke) {
						const marker = yield* store.readActivity;
						if (
							resumed.recovery._tag === "live" &&
							(marker?._tag === "stepping" || resumed.attempt !== null)
						) {
							const attempt = resumed.attempt;
							const seq = attempt?.seq ?? resumed.seq + 1;
							yield* observed(
								Failure.cases.interrupted.make({
									process: process.id,
									letter:
										attempt?.letter ??
										(marker?._tag === "stepping" ? marker.letter : "interrupted"),
									build: process.build,
									seq,
								}),
								status.at,
							);
						}
						woke = true;
					}
					const waiting = yield* currentRecovery;
					if (
						time !== undefined &&
						waiting.recovery._tag === "down" &&
						status.at >= waiting.recovery.until
					) {
						const s = waiting;
						const next = moved(s, {type: "due", at: status.at});
						if (next.recovery._tag === "starting") {
							const request = Start.cases.again.make({
								...next.recovery.request,
								code: {program: process.program, hash: s.build},
							});
							yield* saveRecovery({
								...next,
								recovery: Recovery.cases.starting.make({...next.recovery, request}),
								pending:
									next.pending === null
										? null
										: {...next.pending, from: yield* from(null, yield* traceId)},
							});
							yield* continueRecovery().pipe(
								Effect.withSpan("runner.recover", {
									attributes: {
										[PROCESS]: s.recovery._tag === "down" ? s.recovery.process : process.id,
										[tag("until")]: s.recovery._tag === "down" ? s.recovery.until : 0,
										[tag("lag")]:
											s.recovery._tag === "down" ? Math.max(0, status.at - s.recovery.until) : 0,
									},
								}),
							);
						}
					}
					const latest = yield* currentRecovery;
					if (latest.recovery._tag === "down") yield* alarm.set(latest.recovery.until);
					else if (latest.recovery._tag === "live") {
						const healthy = moved(latest, {type: "healthy", at: status.at});
						if (healthy !== latest) yield* saveRecovery(healthy);
					}
				});

				/** A pure call: a ProgramDown it throws stays itself; any other throw is `why`. */
				const pure = <A>(why: ProgramDown["why"], f: () => A) =>
					Effect.try({
						try: f,
						catch: (error) =>
							error instanceof ProgramDown ? error : new ProgramDown({why, cause: error}),
					});

				const step = Effect.fnUntraced(function* (
					why: ProgramDown["why"],
					letter: string,
					f: () => Step,
				) {
					if (supervision !== null) {
						const status = yield* (yield* coordinator).status(process.name);
						const phase = why === "step" ? "fresh" : "saved";
						const attempt = {
							process: process.id,
							letter,
							build: process.build,
							seq: supervision.seq + 1,
							phase,
							at: status.at,
						} as const;
						yield* saveRecovery({...supervision, seq: attempt.seq, attempt});
					}
					yield* store.activity(
						Activity.cases.stepping.make({process: process.id, letter, build: process.build}),
					);
					const result = yield* pure(why, f).pipe(Effect.exit);
					if (supervision !== null && result._tag === "Failure") {
						const attempt = supervision.attempt;
						if (attempt === null) return yield* new LedgerError({why: "bad_row"});
						if (Cause.hasInterrupts(result.cause)) {
							yield* observed(Failure.cases.interrupted.make(attempt), attempt.at);
							return yield* Effect.failCause(result.cause);
						}
						const wrapped = Cause.squash(result.cause);
						const original =
							wrapped instanceof ProgramDown && Object.hasOwn(wrapped, "cause")
								? wrapped.cause
								: wrapped;
						const error =
							original instanceof Error
								? original.constructor.name
								: original === null
									? "null"
									: typeof original;
						yield* observed(
							(why === "step" ? Failure.cases.fresh : Failure.cases.saved).make({
								...attempt,
								error,
							}),
							attempt.at,
							original,
						);
						return yield* new ProgramDown({why, cause: original});
					}
					if (supervision !== null) yield* saveRecovery({...supervision, attempt: null});
					return yield* result.pipe(
						Effect.onExit((exit) =>
							store
								.activity(Activity.cases.idle.make({process: process.id}))
								.pipe(
									Effect.catch((error) =>
										exit._tag === "Failure" ? Effect.void : Effect.fail(error),
									),
								),
						),
					);
				});

				const stepped = (
					step: Step,
					why: ProgramDown["why"],
				): Effect.Effect<typeof Step.cases.stepped.Type, ProgramDown> =>
					step._tag === "stepped" ? Effect.succeed(step) : Effect.fail(new ProgramDown({why}));

				/** Loads the program and its checkpoint, climbing saved state through its upgrades. */
				const load = Effect.fnUntraced(function* () {
					const loaded = yield* loader.load(process.program);
					const program = loaded.stepper.program;
					const saved = yield* store.load;
					if (saved === null) {
						const boot = yield* stepped(
							yield* pure("load", () => loaded.stepper.init(null)),
							"load",
						);
						const fresh: Live = {
							loaded,
							model: boot.model,
							view: boot.view,
							wake: boot.wake,
							v: program.state.v,
							after: 0,
							pos: 0,
							cmds: [],
						};
						return {live: fresh, dirty: false};
					}
					const cmds = yield* pure("saved_state", () => decodeDispatched(saved.cmds));
					const {saved: next, ran} = yield* pure("saved_state", () =>
						Saved.upgrade(saved.saved, program.state, process.build),
					);
					const boot = yield* stepped(
						yield* pure("saved_state", () => loaded.stepper.init(next.model)),
						"saved_state",
					);
					const upgraded = saved.saved.v !== next.v || ran.length > 0;
					if (upgraded)
						yield* store.record(
							`upgrade:${saved.saved.v}-${next.v}:${next.after}`,
							RuntimeRecord.cases["state.upgraded"].make({
								program: program.name,
								from: saved.saved.v,
								to: next.v,
								ran,
								build: process.build,
							}),
							yield* from(null, yield* traceId),
						);
					const pos =
						next.after === 0
							? 0
							: Option.match(yield* Stream.runHead(mailbox.read(process.name, next.after - 1)), {
									onNone: () => 0,
									onSome: (letter) => (letter.rev === next.after ? letter.pos : 0),
								});
					retry = cmds.filter((cmd) =>
						Option.exists(decodeTyped(cmd.cmd), (c) => c.type === WRITE),
					);
					const woke: Live = {
						loaded,
						model: boot.model,
						view: boot.view,
						wake: boot.wake,
						v: next.v,
						after: next.after,
						pos,
						cmds,
					};
					return {live: woke, dirty: upgraded || saved.turn !== null};
				});

				const checkpoint = (state: Live, turn: unknown) => ({
					saved: {v: state.v, build: process.build, model: state.model, after: state.after},
					turn,
					cmds: state.cmds,
				});

				/** Shows the installed view to every watcher and sets the alarm. */
				const publish = Effect.fnUntraced(function* (before: Live, after: Live) {
					if (after.pos !== before.pos) {
						const patch = diff(before.view, after.view);
						for (const client of clients)
							yield* watchers.publish(client, {
								type: "patch",
								base: before.pos,
								rev: after.pos,
								patch,
							});
					}
					yield* alarm.set(after.wake);
				});

				/**
				 * Folds every inbox letter past `state.after`, records each step, and installs the result
				 * in one save. The letter named `mine` is this turn's: its Cmds are saved as dispatched and
				 * answered for running. `done` is a Cmd now answered, dropped in the same save.
				 */
				const catchUp = Effect.fnUntraced(function* (
					state: Live,
					options: {readonly mine?: string; readonly done?: string; readonly dirty?: boolean} = {},
				) {
					const letters = yield* Stream.runCollect(mailbox.read(process.name, state.after));
					if (letters.length === 0 && options.done === undefined && options.dirty !== true)
						return {state, fresh: [] as ReadonlyArray<Dispatched>, mine: Option.none<History>()};
					let model = state.model;
					let view = state.view;
					let wake = state.wake;
					const fresh: Array<Dispatched> = [];
					const placed: Array<Placed> = [];
					let mine = Option.none<History>();
					for (const letter of letters) {
						const folded = yield* stepped(
							yield* step("saved_letter", letter.id, () =>
								state.loaded.stepper.fold(model, letter.m),
							),
							"saved_letter",
						);
						yield* store.record(
							`step:${letter.id}`,
							RuntimeRecord.cases.stepped.make({
								input: letter.id,
								pos: letter.pos,
								build: process.build,
							}),
							yield* from(letter.parent, letter.traceId),
						);
						model = folded.model;
						view = folded.view;
						wake = folded.wake;
						placed.push({id: letter.id, rev: letter.rev, pos: letter.pos});
						if (letter.id === options.mine) {
							mine = Option.some(letter);
							for (const [index, cmd] of folded.cmds.entries())
								fresh.push({
									id: `${process.id}/${letter.pos}/${index}`,
									cmd,
									state: "dispatched",
									parent: letter.parent,
									traceId: letter.traceId,
									build: process.build,
								});
						}
					}
					const last = letters.at(-1);
					const next: Live = {
						...state,
						model,
						view,
						wake,
						after: last?.rev ?? state.after,
						pos: last?.pos ?? state.pos,
						cmds: [...state.cmds.filter((cmd) => cmd.id !== options.done), ...fresh],
					};
					yield* store.save(checkpoint(next, null), placed);
					live = next;
					yield* publish(state, next);
					return {state: next, fresh: fresh as ReadonlyArray<Dispatched>, mine};
				});

				/** The live process, loaded and caught up. */
				const ready = Effect.fnUntraced(function* () {
					yield* ensure();
					if (supervision !== null && supervision.recovery._tag !== "live")
						return yield* new ProgramDown({why: "saved_letter"});
					if (live !== null) return (yield* catchUp(live)).state;
					const {live: loaded, dirty} = yield* load();
					const {state} = yield* catchUp(loaded, {dirty});
					live = state;
					return state;
				});

				/** Takes the writes an earlier life left dispatched, to run them once. */
				const takeRetry = () => {
					const taken = retry;
					retry = [];
					return taken;
				};

				// --- Cmds ---------------------------------------------------------------------------

				const at = Clock.currentTimeMillis;
				const ok = (job: Dispatched, value: unknown) =>
					Effect.map(at, (time) => ({type: `${cmdType(job)}_ok`, cmd: job.cmd, value, at: time}));
				const err = (job: Dispatched, why: string, error: unknown = failure(why)) =>
					Effect.map(at, (time) => ({
						type: `${cmdType(job)}_err`,
						cmd: job.cmd,
						error,
						why,
						at: time,
					}));

				/** The span one Cmd runs in. */
				const cmdSpan =
					(job: Dispatched) =>
					<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
						work.pipe(
							Effect.withSpan("runner.cmd", {
								attributes: {
									[PROCESS]: process.id,
									[tag("cmd")]: cmdType(job),
									[tag("id")]: job.id,
								},
							}),
						);

				/** A checked write: the fact must be declared, not reserved, and match its schema. */
				const write = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
					const input = decodeWriteCmd(job.cmd);
					if (Result.isFailure(input)) return yield* err(job, "bad_cmd");
					const {stream, write: asked} = input.success;
					const fact = asked.fact;
					const kind = typeof fact._tag === "string" ? fact._tag : null;
					const writes = state.loaded.stepper.program.writes;
					const policy = kind !== null && Object.hasOwn(writes, kind) ? writes[kind] : undefined;
					if (kind === null || RESERVED.has(kind) || policy === undefined || !isFact(fact))
						return yield* err(job, "bad_cmd");
					if (Result.isFailure(Schema.decodeUnknownResult(policy.schema)(fact)))
						return yield* err(job, "bad_cmd");
					const commit = <E>(
						appended: Effect.Effect<Appended, E>,
						links: ReadonlyArray<Tracer.SpanLink>,
					) =>
						appended.pipe(
							Effect.withSpan("runner.write", {
								attributes: {
									[PROCESS]: process.id,
									[tag("write")]: job.id,
									[tag("stream")]: stream,
								},
								links,
							}),
						);
					const attempt: Effect.Effect<Appended, LedgerError | SigningRefused | NotGranted> =
						Effect.gen(function* () {
							if (asked._tag === "own") {
								if (policy.personOnly) return yield* new SigningRefused({why: "person_only"});
								return yield* commit(checked.own(job.id, stream, fact), []);
							}
							if (Option.isNone(sessions))
								return yield* Effect.die(new Error("a caused write needs a SessionManager"));
							const session = yield* sessions.value
								.signer(asked.parent, process.id, kind)
								.pipe(Effect.provideService(SignRequest, {id: job.id}));
							return yield* commit(checked.commit(job.id, session, stream, fact), [
								{span: Tracer.externalSpan(session.span), attributes: {}},
							]);
						});
					// A refusal is the Cmd's answer; a storage failure is not, so the Cmd stays dispatched.
					const answer = yield* attempt.pipe(
						Effect.map((placed): Result.Result<Appended, string> => Result.succeed(placed)),
						Effect.catchIf(
							(e): e is SigningRefused | NotGranted =>
								e instanceof SigningRefused || e instanceof NotGranted,
							(e) =>
								Effect.succeed<Result.Result<Appended, string>>(
									Result.fail(e instanceof SigningRefused ? e.why : "not_granted"),
								),
						),
					);
					if (Result.isFailure(answer)) return yield* err(job, answer.failure);
					if (answer.success._tag !== "placed") return yield* err(job, "bad_cmd");
					return yield* ok(job, answer.success);
				});

				/** A handler's Cmd. Only a declared Cmd with a handler runs; its answer is checked. */
				const handle = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
					const type = cmdType(job);
					const def = (state.loaded.stepper.program.machine.cmds ?? []).find(
						(d) => d.cmdType === type,
					);
					const run = state.loaded.handler(type);
					if (def === undefined || Option.isNone(run)) return yield* err(job, "bad_cmd");
					// The handler's own failure ends its span failed, with the message as deletable content.
					const exit = yield* cmdSpan(job)(run.value(job.cmd)).pipe(Effect.exit);
					if (exit._tag === "Failure") {
						// An interrupted handler stays dispatched: nobody knows whether it acted.
						if (Cause.hasInterrupts(exit.cause)) return yield* Effect.interrupt;
						return yield* err(job, "handler_failed");
					}
					const outcome: Outcome<unknown, unknown> = exit.value;
					if (outcome._tag === "Ok")
						return yield* isAccepted(def.schema.ok, outcome.value)
							? ok(job, outcome.value)
							: err(job, "bad_cmd");
					const declared = def.errTags.find(
						(t) =>
							typeof outcome.error === "object" &&
							outcome.error !== null &&
							"_tag" in outcome.error &&
							outcome.error._tag === t,
					);
					return yield* declared === undefined
						? err(job, "bad_cmd")
						: err(job, declared, outcome.error);
				});

				/** Runs one saved Cmd, saves its answer as a letter, and folds it. Answers the Cmds that
				 *  answer's step made. A failure that is not an answer leaves the Cmd dispatched. */
				const dispatch = (
					job: Dispatched,
				): Effect.Effect<ReadonlyArray<Dispatched>, RunnerFailure> =>
					Effect.gen(function* () {
						if (
							!job.id.startsWith(`${process.id}/`) ||
							(supervision !== null && supervision.recovery._tag !== "live")
						)
							return [];
						const origin = process;
						const originStore = store;
						const state = live;
						if (state === null) return [];
						const m = yield* cmdType(job) === WRITE
							? cmdSpan(job)(write(state, job))
							: handle(state, job);
						return yield* permit.withPermit(
							Effect.gen(function* () {
								const answer = `${job.id}/answer`;
								if (
									origin.id !== process.id ||
									(supervision !== null && supervision.recovery._tag !== "live")
								) {
									yield* originStore.record(
										answer,
										RuntimeRecord.cases["cmd.answered"].make({
											m: Schema.decodeUnknownSync(Schema.Json)(m),
											cmd: job.id,
											build: origin.build,
										}),
										{...(yield* from(job.parent, job.traceId)), build: origin.build},
									);
									const old = yield* originStore.load;
									if (old !== null)
										yield* originStore.save({
											...old,
											cmds: old.cmds.filter(
												(cmd) =>
													typeof cmd !== "object" ||
													cmd === null ||
													!("id" in cmd) ||
													cmd.id !== job.id,
											),
										});
									return [];
								}
								const current = yield* ready();
								const sent = yield* mailbox.send(
									process.name,
									answer,
									m,
									yield* from(job.parent, job.traceId),
								);
								if (sent._tag === "refused")
									return yield* new LedgerError({why: "refused", message: sent.why});
								return (yield* catchUp(current, {mine: answer, done: job.id})).fresh;
							}),
						);
					});

				/** Runs Cmds in order, each one's follow-ups before the next. */
				const runAll = (jobs: ReadonlyArray<Dispatched>): Effect.Effect<void, RunnerFailure> =>
					Effect.forEach(jobs, (job) => Effect.flatMap(dispatch(job), runAll), {
						concurrency: 1,
						discard: true,
					});

				/** One public call: its span, its Cmds, then the flush, on success and failure. */
				const call = <A>(
					name: string,
					turn: Effect.Effect<
						{readonly answer: A; readonly jobs: ReadonlyArray<Dispatched>},
						RunnerFailure
					>,
				): Effect.Effect<A, RunnerFailure> =>
					Effect.gen(function* () {
						const {answer, jobs} = yield* turn;
						yield* flushed;
						yield* runAll(jobs);
						return answer;
					}).pipe(
						Effect.withSpan(name, {
							attributes: {[PROCESS]: process.id, [tag("name")]: process.name},
						}),
						Effect.exit,
						Effect.flatMap((exit) =>
							flushed.pipe(
								Effect.flatMap(() => exit),
								Effect.catch((error) => (exit._tag === "Failure" ? exit : Effect.fail(error))),
							),
						),
					);

				const turn = <A>(
					body: (
						state: Live,
					) => Effect.Effect<
						{readonly answer: A; readonly jobs: ReadonlyArray<Dispatched>},
						RunnerFailure
					>,
				) =>
					permit.withPermit(
						Effect.gen(function* () {
							const state = yield* ready();
							const retried = takeRetry();
							const {answer, jobs} = yield* body(state);
							return {answer, jobs: [...retried, ...jobs]};
						}),
					);

				return {
					open: (client: string) =>
						call(
							"runner.open",
							turn((state) =>
								Effect.gen(function* () {
									clients.add(client);
									yield* watchers.publish(client, {
										type: "whole",
										rev: state.pos,
										view: state.view,
									});
									return {answer: {rev: state.pos, view: state.view}, jobs: []};
								}),
							),
						),
					msg: (raw: unknown) =>
						call(
							"runner.step",
							Effect.gen(function* () {
								const input = yield* decodeIncoming(raw).pipe(
									Effect.mapError(() => new RunnerError({why: "bad_input"})),
								);
								yield* Effect.annotateCurrentSpan(tag("letter"), input.id);
								return yield* permit.withPermit(
									Effect.gen(function* () {
										yield* ensure();
										const receipt = supervision?.receipts.find((r) => r.letter === input.id);
										if (receipt !== undefined) {
											const original = Schema.decodeUnknownSync(Incoming)(receipt.input);
											const identity = (i: Incoming) =>
												JSON.stringify([i.envelope.by, i.envelope.input, i.sentAt, i.seen]);
											if (identity(input) !== identity(original))
												return {answer: Sent.cases.refused.make({why: "id_reused"}), jobs: []};
											if (receipt.result !== null)
												return {answer: Sent.cases.refused.make({why: "dead"}), jobs: []};
										}
										const state = yield* ready();
										const retried = takeRetry();
										const {answer, jobs} = yield* accept(state, input);
										return {answer, jobs: [...retried, ...jobs]};
									}),
								);
							}),
						),
					due: (time: number) =>
						call(
							"runner.due",
							permit.withPermit(
								Effect.gen(function* () {
									yield* ensure(time);
									if (supervision !== null && supervision.recovery._tag !== "live")
										return {answer: undefined, jobs: []};
									const state = yield* ready();
									if (state.wake === null || state.wake > time)
										return {answer: undefined, jobs: []};
									const id = `${process.id}/due/${time}`;
									const sent = yield* mailbox.send(
										process.name,
										id,
										{type: "timer", at: time},
										yield* from(null, yield* traceId),
									);
									if (sent._tag === "refused")
										return yield* new LedgerError({why: "refused", message: sent.why});
									const {fresh} = yield* catchUp(state, {mine: id});
									return {answer: undefined, jobs: fresh};
								}),
							),
						),
					restart: (request: {readonly id: string; readonly build: string}) =>
						call(
							"runner.restart.request",
							permit.withPermit(
								Effect.gen(function* () {
									if (recovery === null) return yield* new LedgerError({why: "unreachable"});
									yield* ensure();
									const s = yield* currentRecovery;
									const prior = s.requests?.find((r) => r.id === request.id);
									if (prior !== undefined) {
										if (prior.build !== request.build)
											return yield* new RunnerError({why: "bad_input"});
										return {answer: undefined, jobs: []};
									}
									const p = yield* coordinator;
									const status = yield* p.status(process.name);
									const after = status.state.process;
									const start = Start.cases.again.make({
										id: request.id,
										name: s.name,
										after,
										why: "restart",
										code: {program: process.program, hash: request.build},
									});
									const meta = yield* from(null, yield* traceId);
									if (status.state._tag === "live") {
										const failure = Failure.cases.interrupted.make({
											process: after,
											letter: request.id,
											build: process.build,
											seq: s.seq + 1,
										});
										yield* saveRecovery({
											...s,
											restart: request,
											recovery: Recovery.cases.ending.make({process: after, failure}),
											pending: {type: "exit", process: after, from: meta},
										});
									} else
										yield* saveRecovery({
											...s,
											build: request.build,
											restart: request,
											recovery: Recovery.cases.starting.make({after, request: start}),
											pending: {type: "start", process: after, from: meta},
										});
									yield* continueRecovery();
									yield* ready();
									return {answer: undefined, jobs: []};
								}),
							),
						),
				};

				/** A fresh input's turn. The permit is held. */
				function accept(
					state: Live,
					input: Incoming,
				): Effect.Effect<
					{readonly answer: Sent; readonly jobs: ReadonlyArray<Dispatched>},
					RunnerFailure
				> {
					return Effect.gen(function* () {
						const prior = yield* store.placed(input.id);
						if (prior !== null)
							return {answer: Sent.cases.accepted.make({rev: prior.rev, pos: prior.pos}), jobs: []};
						const history = yield* Stream.runCollect(mailbox.read(process.name, 0));
						const existing = history.find((letter) => letter.id === input.id);
						if (existing !== undefined)
							return {
								answer: Sent.cases.accepted.make({rev: existing.rev, pos: existing.pos}),
								jobs: [],
							};
						if (supervision !== null && !supervision.receipts.some((r) => r.letter === input.id))
							yield* saveRecovery({
								...supervision,
								receipts: [
									...supervision.receipts,
									{
										letter: input.id,
										input: Schema.decodeUnknownSync(Schema.Json)(input),
										errors: [],
										tries: 0,
										result: null,
										process: process.id,
									},
								],
							});
						const preparation = yield* Effect.result(
							step("step", input.id, () =>
								state.loaded.stepper.step(state.model, input.envelope.input),
							),
						);
						if (Result.isFailure(preparation)) {
							const terminal = supervision?.receipts.find((r) => r.letter === input.id)?.result;
							if (
								preparation.failure instanceof ProgramDown &&
								terminal !== null &&
								terminal !== undefined &&
								supervision?.pending === null
							)
								return {answer: Sent.cases.refused.make({why: "dead"}), jobs: []};
							return yield* Effect.fail(preparation.failure);
						}
						const prepared = preparation.success;
						if (prepared._tag === "refused") {
							const {_tag: _case, ...why} = prepared;
							return {answer: Sent.cases.refused.make(why), jobs: []};
						}
						yield* store.save(checkpoint(state, Turn.cases.prepared.make({id: input.id})));
						const appended = yield* checked.append(input);
						if (appended._tag === "refused") {
							yield* store.save(checkpoint(state, null));
							return {answer: Sent.cases.refused.make({why: appended.why}), jobs: []};
						}
						const {fresh} = yield* catchUp(state, {mine: input.id, dirty: true});
						return {
							answer: Sent.cases.accepted.make({rev: appended.rev, pos: appended.pos}),
							jobs: fresh,
						};
					});
				}
			}),
		);
}

/** A delivery that does not have P10's shape. */
export class RunnerError extends Schema.TaggedError<RunnerError>()("RunnerError", {
	why: Schema.Literals(["bad_input"]),
}) {}

type RunnerFailure = LedgerError | ProgramDown | RunnerError | SinkError | ProcessError;

const cmdType = (job: Dispatched): string =>
	Option.match(decodeTyped(job.cmd), {onNone: () => "", onSome: (c) => c.type});

const isFact = (u: Readonly<Record<string, Schema.Json>>): u is Fact => typeof u._tag === "string";

const isAccepted = (
	schema: {readonly "~standard": {readonly validate: (value: unknown) => unknown}},
	value: unknown,
): boolean => {
	const answer = schema["~standard"].validate(value);
	return (
		typeof answer === "object" && answer !== null && "value" in answer && !("issues" in answer)
	);
};
