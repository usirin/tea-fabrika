// The program runner, next/: one process's turns (Tier 1, P11). Under one permit a turn catches
// the process up on its inbox, finds a resend, steps the fresh input purely, saves that it is
// about to append, appends through the door's checked writer, folds what landed and installs it.
// Only then do its Cmds run, each saved as dispatched first, each answer saved as a letter before
// the program sees it. A wake folds saved letters and runs none of their Cmds.
import {type Outcome} from "@demlik/tea";
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
	type Appended,
	brainOnly,
	type From,
	type History,
	inRunnerSpace,
	LedgerError,
	Mailbox,
	MemberFact,
	NotGranted,
	ParentText,
	type Placed,
	ProcessFact,
	ProcessStore,
	RuntimeRecord,
	RunnerMail,
	SessionManager,
	SigningRefused,
	SignRequest,
	type SinkError,
	type Writer,
} from "../coordination/index.ts";
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
import {ProgramDown, Refusal, Step, Write} from "./program.ts";

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
	readonly loaded: Omit<Loaded, "stepper">;
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
	}
>()("@kampus/libfabrika/ProgramRunner") {
	/** Load in process, keeping the pure stepper available to callers of ProgramLoader. */
	static readonly layer = (
		process: Descriptor,
	): Layer.Layer<
		ProgramRunner,
		never,
		ProgramLoader | ProcessStore | Mailbox | CheckedWriter | WatcherManager | Alarm | Recording
	> =>
		Layer.unwrap(Effect.map(ProgramLoader, (loader) => ProgramRunner.withLoader(process, loader)));

	/** Worker programs keep their pure stepper inside the box; the runner needs only execution. */
	static readonly withLoader = (
		process: Descriptor,
		loader: {
			readonly load: (
				name: string,
				build?: string,
			) => Effect.Effect<Omit<Loaded, "stepper">, ProgramDown>;
		},
	): Layer.Layer<
		ProgramRunner,
		never,
		ProcessStore | Mailbox | CheckedWriter | WatcherManager | Alarm | Recording
	> =>
		Layer.effect(
			ProgramRunner,
			Effect.gen(function* () {
				const store = yield* ProcessStore;
				const mailbox = yield* Mailbox;
				const checked = yield* CheckedWriter;
				const watchers = yield* WatcherManager;
				const alarm = yield* Alarm;
				const recording = yield* Recording;
				const sessions = yield* Effect.serviceOption(SessionManager);
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

				/** A pure call: a ProgramDown it throws stays itself; any other throw is `why`. */
				const pure = Effect.fnUntraced(function* <A>(why: ProgramDown["why"], f: () => A) {
					return yield* Effect.try({
						try: f,
						catch: (error) => (error instanceof ProgramDown ? error : new ProgramDown({why})),
					});
				});

				const step = Effect.fnUntraced(function* (
					_why: ProgramDown["why"],
					letter: string,
					f: () => Effect.Effect<Step, ProgramDown>,
				) {
					yield* store.activity(
						Activity.cases.stepping.make({process: process.id, letter, build: process.build}),
					);
					return yield* f().pipe(
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

				const stepped = Effect.fnUntraced(function* (step: Step, why: ProgramDown["why"]) {
					return yield* step._tag === "stepped"
						? Effect.succeed(step)
						: Effect.fail(new ProgramDown({why}));
				});

				/** Loads the program and its checkpoint, climbing saved state through its upgrades. */
				const load = Effect.fnUntraced(function* () {
					const loaded = yield* loader.load(process.program, process.build);
					const program = loaded.declaration;
					const saved = yield* store.load;
					if (saved === null) {
						const boot = yield* stepped(yield* loaded.execution.init(null), "load");
						const fresh: Live = {
							loaded,
							model: boot.model,
							view: boot.view,
							wake: boot.wake,
							v: program.v,
							after: 0,
							pos: 0,
							cmds: [],
						};
						return {live: fresh, dirty: false};
					}
					const cmds = yield* pure("saved_state", () => decodeDispatched(saved.cmds));
					const {saved: next, ran} = yield* loaded.execution.upgrade(saved.saved);
					const boot = yield* stepped(yield* loaded.execution.init(next.model), "saved_state");
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
				 * Accepted letters fold; other mail takes the fresh checks and cannot fail the process.
				 * Every first fold saves its Cmds, but only this call's letter returns Cmds to run.
				 */
				const catchUp = Effect.fnUntraced(function* (
					state: Live,
					options: {readonly mine?: string; readonly dirty?: boolean} = {},
				) {
					const letters = yield* Stream.runCollect(mailbox.read(process.name, state.after));
					const saved = yield* store.load;
					if (saved === null) yield* store.save(checkpoint(state, null));
					if (letters.length === 0 && options.dirty !== true)
						return {state, fresh: [] as ReadonlyArray<Dispatched>, mine: Option.none<History>()};
					let model = state.model;
					let view = state.view;
					let wake = state.wake;
					const fresh: Array<Dispatched> = [];
					let cmds = state.cmds;
					const placed: Array<Placed> = [];
					const prepared = Schema.decodeUnknownOption(Turn)(saved?.turn);
					let mine = Option.none<History>();
					for (const letter of letters) {
						const own = inRunnerSpace(letter.id) && letter.id.startsWith(`${process.id}/`);
						const accepted =
							own ||
							letter.id === options.mine ||
							Option.exists(prepared, (turn) => turn.id === letter.id) ||
							(yield* store.placed(letter.id)) !== null;
						const m =
							accepted && !own && letter.parent !== null
								? stamp(letter.m, letter.parent)
								: letter.m;
						const folded = accepted
							? yield* stepped(
									yield* step("saved_letter", letter.id, () =>
										state.loaded.execution.fold(model, m),
									),
									"saved_letter",
								)
							: yield* receive(state, model, letter.m);
						if (folded._tag === "refused") continue;
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
						if (own && letter.id.endsWith("/answer"))
							cmds = cmds.filter((cmd) => cmd.id !== letter.id.slice(0, -"/answer".length));
						const dispatched = folded.cmds.map((cmd, index): Dispatched => ({
							id: `${process.id}/${letter.pos}/${index}`,
							cmd,
							state: "dispatched",
							parent: letter.parent,
							traceId: letter.traceId,
							build: process.build,
						}));
						cmds = [...cmds, ...dispatched];
						if (letter.id === options.mine) {
							mine = Option.some(letter);
							fresh.push(...dispatched);
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
						cmds,
					};
					yield* store.save(checkpoint(next, null), placed);
					live = next;
					yield* publish(state, next);
					return {state: next, fresh: fresh as ReadonlyArray<Dispatched>, mine};
				});

				const receive = Effect.fnUntraced(function* (state: Live, model: unknown, m: unknown) {
					const port = inputPort(state, m);
					if (port === undefined || !port.write || port.personOnly || hasParent(m))
						return Step.cases.refused.make({why: "bad_msg"});
					const refused = Step.cases.refused.make({why: "bad_msg"});
					return yield* state.loaded.execution.admit(m).pipe(
						Effect.flatMap((admitted) =>
							admitted ? state.loaded.execution.step(model, m) : Effect.succeed(refused),
						),
						Effect.catchIf(
							(error) => error.why === "step" && error.source === undefined,
							() => Effect.succeed(refused),
						),
					);
				});

				/** The live process, loaded and caught up. */
				const ready = Effect.fnUntraced(function* () {
					if (live !== null) return (yield* catchUp(live)).state;
					const {live: loaded, dirty} = yield* load();
					const {state} = yield* catchUp(loaded, {dirty});
					live = state;
					return state;
				});

				/** Takes the writes an earlier life left dispatched, to run them once. */
				const takeRetry = () => {
					const taken = retry.filter((job) => live?.cmds.some((cmd) => cmd.id === job.id));
					retry = [];
					return taken;
				};

				// --- Cmds ---------------------------------------------------------------------------

				const at = Clock.currentTimeMillis;
				const ok = Effect.fnUntraced(function* (job: Dispatched, value: unknown) {
					return yield* Effect.map(at, (time) => ({
						type: `${cmdType(job)}_ok`,
						cmd: job.cmd,
						value,
						at: time,
					}));
				});
				const err = Effect.fnUntraced(function* (
					job: Dispatched,
					why: string,
					error: unknown = failure(why),
				) {
					return yield* Effect.map(at, (time) => ({
						type: `${cmdType(job)}_err`,
						cmd: job.cmd,
						error,
						why,
						at: time,
					}));
				});

				/** The span one Cmd runs in. */
				const cmdSpan = Effect.fn("runner.cmd")(function* <A, E>(
					job: Dispatched,
					work: Effect.Effect<A, E>,
				) {
					yield* Effect.annotateCurrentSpan({
						[PROCESS]: process.id,
						[tag("cmd")]: cmdType(job),
						[tag("id")]: job.id,
					});
					return yield* work;
				});

				/** A checked write: the fact must be declared, not reserved, and match its schema. */
				const write = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
					const input = decodeWriteCmd(job.cmd);
					if (Result.isFailure(input)) return yield* err(job, "bad_cmd");
					const {stream, write: asked} = input.success;
					const fact = asked.fact;
					const kind = typeof fact._tag === "string" ? fact._tag : null;
					const writes = state.loaded.declaration.writes;
					const policy = kind !== null && Object.hasOwn(writes, kind) ? writes[kind] : undefined;
					if (kind === null || RESERVED.has(kind) || policy === undefined || !isFact(fact))
						return yield* err(job, "bad_cmd");
					if (
						brainOnly({stream, id: job.id, tag: kind}) ||
						stream === "door" ||
						stream.startsWith("door/") ||
						(stream.endsWith("/inbox") && stream !== `${process.name}/inbox`)
					)
						return yield* err(job, "forbidden");
					if (!(yield* state.loaded.execution.check(kind, fact))) return yield* err(job, "bad_cmd");
					const commit = (links: ReadonlyArray<Tracer.SpanLink>) =>
						Effect.fn("runner.write", {
							attributes: {
								[PROCESS]: process.id,
								[tag("write")]: job.id,
								[tag("stream")]: stream,
							},
							links,
						})(function* <E>(appended: Effect.Effect<Appended, E>) {
							return yield* appended;
						});
					const attempt: Effect.Effect<Appended, LedgerError | SigningRefused | NotGranted> =
						Effect.gen(function* () {
							if (asked._tag === "own") {
								if (policy.personOnly) return yield* new SigningRefused({why: "person_only"});
								return yield* commit([])(checked.own(job.id, stream, fact));
							}
							if (checked.sign === undefined && Option.isNone(sessions))
								return yield* Effect.die(new Error("a caused write needs a SessionManager"));
							const session = yield* checked.sign !== undefined
								? checked.sign(job.id, asked.parent, kind)
								: Option.getOrThrow(sessions)
										.signer(asked.parent, process.id, kind)
										.pipe(Effect.provideService(SignRequest, {id: job.id}));
							return yield* commit([{span: Tracer.externalSpan(session.span), attributes: {}}])(
								checked.commit(job.id, session, stream, fact),
							);
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
					if (answer.success._tag === "refused") return yield* err(job, answer.success.why);
					return yield* ok(job, answer.success);
				});

				/** A handler's Cmd. Only a declared Cmd with a handler runs; its answer is checked. */
				const handle = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
					const type = cmdType(job);
					const declared = state.loaded.declaration.cmds.includes(type);
					const run = state.loaded.handler(type);
					if (!declared || Option.isNone(run)) return yield* err(job, "bad_cmd");
					// The handler's own failure ends its span failed, with the message as deletable content.
					const exit = yield* cmdSpan(job, run.value(job.cmd)).pipe(Effect.exit);
					if (exit._tag === "Failure") {
						// An interrupted handler stays dispatched: nobody knows whether it acted.
						if (Cause.hasInterrupts(exit.cause)) return yield* Effect.interrupt;
						return yield* err(job, "handler_failed");
					}
					const outcome: Outcome<unknown, unknown> = exit.value;
					// The box checks the declared tag and encodes the answer (main's P11 encoding); an Err
					// also carries its tag as `why`, as the runner's own errors do.
					return yield* state.loaded.execution.reply(job.cmd, {...outcome, at: yield* at}).pipe(
						Effect.map((m) => {
							const tag = outcome._tag === "Err" ? errTag(outcome.error) : undefined;
							return tag !== undefined && typeof m === "object" && m !== null && !Array.isArray(m)
								? {...m, why: tag}
								: m;
						}),
						Effect.catch(() => err(job, "bad_cmd")),
					);
				});

				/** Runs one saved Cmd, saves its answer as a letter, and folds it. Answers the Cmds that
				 *  answer's step made. A failure that is not an answer leaves the Cmd dispatched. */
				const dispatch = Effect.fnUntraced(function* (
					job: Dispatched,
				): Effect.fn.Return<ReadonlyArray<Dispatched>, RunnerFailure> {
					const state = live;
					if (state === null) return [];
					const m = yield* cmdType(job) === WRITE
						? cmdSpan(job, write(state, job))
						: handle(state, job);
					return yield* permit.withPermit(
						Effect.gen(function* () {
							const current = yield* ready();
							const answer = `${job.id}/answer`;
							const sent = yield* mailbox
								.send(process.name, answer, m, yield* from(job.parent, job.traceId))
								.pipe(Effect.provideService(RunnerMail, {process: process.id, name: process.name}));
							if (sent._tag === "refused")
								return yield* new LedgerError({why: "refused", message: sent.why});
							return (yield* catchUp(current, {mine: answer})).fresh;
						}),
					);
				});

				/** Runs Cmds in order, each one's follow-ups before the next. */
				const runAll = Effect.fnUntraced(function* (
					jobs: ReadonlyArray<Dispatched>,
				): Effect.fn.Return<void, RunnerFailure> {
					yield* Effect.forEach(jobs, (job) => Effect.flatMap(dispatch(job), runAll), {
						concurrency: 1,
						discard: true,
					});
				});

				/** One public call: its span, its Cmds, then the flush, on success and failure. */
				const call = (name: string) => {
					const operation = Effect.fn(name, {
						attributes: {[PROCESS]: process.id, [tag("name")]: process.name},
					})(function* <A>(
						turn: Effect.Effect<
							{readonly answer: A; readonly jobs: ReadonlyArray<Dispatched>},
							RunnerFailure
						>,
					) {
						const {answer, jobs} = yield* turn;
						yield* runAll(jobs);
						return answer;
					});
					return Effect.fnUntraced(function* <A>(
						turn: Effect.Effect<
							{readonly answer: A; readonly jobs: ReadonlyArray<Dispatched>},
							RunnerFailure
						>,
					) {
						const exit = yield* Effect.exit(operation(turn));
						return yield* recording.flush.pipe(
							Effect.flatMap(() => exit),
							Effect.catch((error) => (exit._tag === "Failure" ? exit : Effect.fail(error))),
						);
					});
				};
				const open = call("runner.open");
				const msg = call("runner.step");
				const due = call("runner.due");

				const turn = Effect.fnUntraced(function* <A>(
					body: (
						state: Live,
					) => Effect.Effect<
						{readonly answer: A; readonly jobs: ReadonlyArray<Dispatched>},
						RunnerFailure
					>,
				) {
					return yield* permit.withPermit(
						Effect.gen(function* () {
							const state = yield* ready();
							const retried = takeRetry();
							const {answer, jobs} = yield* body(state);
							return {answer, jobs: [...retried, ...jobs]};
						}),
					);
				});

				return {
					open: (client: string) =>
						open(
							turn((state) =>
								Effect.gen(function* () {
									if (client.length === 0 || client.length > 256)
										return yield* new RunnerError({why: "bad_client"});
									clients.delete(client);
									if (clients.size >= 1024) {
										const oldest = clients.values().next();
										if (!oldest.done) clients.delete(oldest.value);
									}
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
						msg(
							Effect.gen(function* () {
								const input = yield* decodeIncoming(raw).pipe(
									Effect.mapError(() => new RunnerError({why: "bad_input"})),
								);
								yield* Effect.annotateCurrentSpan(tag("letter"), input.id);
								return yield* turn((state) => accept(state, input));
							}),
						),
					due: (time: number) =>
						due(
							turn((state) =>
								Effect.gen(function* () {
									if (state.wake === null || state.wake > time)
										return {answer: undefined, jobs: []};
									const id = `${process.id}/due/${time}`;
									const sent = yield* mailbox
										.send(
											process.name,
											id,
											{type: "timer", at: time},
											yield* from(null, yield* traceId),
										)
										.pipe(
											Effect.provideService(RunnerMail, {process: process.id, name: process.name}),
										);
									if (sent._tag === "refused")
										return yield* new LedgerError({why: "refused", message: sent.why});
									const {fresh} = yield* catchUp(state, {mine: id});
									return {answer: undefined, jobs: fresh};
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
						if (
							brainOnly({stream: `${process.name}/inbox`, id: input.id, tag: "send"}) ||
							hasParent(input.envelope.input)
						)
							return {answer: Sent.cases.refused.make({why: "bad_msg"}), jobs: []};
						const prior = yield* store.placed(input.id);
						if (prior !== null)
							return {answer: Sent.cases.accepted.make({rev: prior.rev, pos: prior.pos}), jobs: []};
						const port = inputPort(state, input.envelope.input);
						if (
							port === undefined ||
							!port.write ||
							(port.personOnly && input.envelope.by._tag !== "person")
						)
							return {answer: Sent.cases.refused.make({why: "bad_msg"}), jobs: []};
						const m = stamp(input.envelope.input, input.envelope.id);
						// The port's schema runs inside the box; Schemas do not cross its RPC (P12).
						if (!(yield* state.loaded.execution.admit(m)))
							return {answer: Sent.cases.refused.make({why: "bad_msg"}), jobs: []};
						const prepared = yield* step("step", input.id, () =>
							state.loaded.execution.step(state.model, m),
						);
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
	why: Schema.Literals(["bad_input", "bad_client"]),
}) {}

type RunnerFailure = LedgerError | ProgramDown | RunnerError | SinkError;

const cmdType = (job: Dispatched): string =>
	Option.match(decodeTyped(job.cmd), {onNone: () => "", onSome: (c) => c.type});

const hasParent = (m: unknown): boolean => typeof m === "object" && m !== null && "parent" in m;
const stamp = (m: unknown, parent: string): unknown =>
	typeof m === "object" && m !== null ? {...m, parent} : m;
const inputPort = (state: Live, m: unknown) =>
	Option.match(decodeTyped(m), {
		onNone: () => undefined,
		onSome: ({type}) => {
			const inputs = state.loaded.declaration.inputs;
			return Object.hasOwn(inputs, type) ? inputs[type] : undefined;
		},
	});

const isFact = (u: Readonly<Record<string, Schema.Json>>): u is Fact => typeof u._tag === "string";

/** An Err outcome's tag, when its error is tagged. */
const errTag = (error: unknown): string | undefined =>
	typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
		? error._tag
		: undefined;
