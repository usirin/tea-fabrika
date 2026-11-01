// Experiment 168's factory: the six stages as real tea programs with fake agents, a fake ledger
// they all read and write, and the four loop shapes. No model, no network, no key.
//
//   the world     a fake ledger (facts per ticket), the scripted outcomes, the agent runs counted
//   the stages    tracker, triage, plan, build, review, ship: one program each, by one rule
//   the shapes    a named pipe (mkfifo), a wire back on the line (^build), a parent (build-review),
//                 and the loop through the tracker
//   the shell     tsh itself, started in this process, told lines as a person types them
//
// Every stage reads the ticket's facts first, as docs/direction/read-fresh-run-alone.md says: a
// stage whose last word on the ticket was `done`, with no `send` to it since, passes the ticket on
// and runs no agent. So a line started again, or a ticket that comes round again, costs nothing
// where nothing is left to do.
import {defineMachine} from "@demlik/tea";
import {
	call,
	defineProgram,
	type Entry,
	ear,
	flag,
	input,
	kind,
	listed,
	memoryStorage,
	output,
	Shell,
	type Storage,
	start,
	tell,
} from "@kampus/fabrika-old";
import {type AnyOutcome, nameOf} from "@kampus/pipeline/stages/outcome";
import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {
	type Cause,
	Context,
	Deferred,
	Duration,
	Effect,
	Layer,
	PubSub,
	Queue,
	Schema,
	Stream,
} from "effect";

// ---------------------------------------------------------------- the world

export const STAGES = ["triage", "plan", "build", "review", "ship"] as const;
export type Stage = (typeof STAGES)[number];
export type Pick = "approve" | "no";

/** One fact on the fake ledger. The real ledger's are richer; these are the ones a stage reads. */
export type Fact =
	| {readonly kind: "filed"; readonly ticket: number; readonly title: string}
	| {
			readonly kind: "outcome";
			readonly ticket: number;
			readonly stage: Stage;
			readonly outcome: AnyOutcome;
	  }
	| {readonly kind: "answer"; readonly ticket: number; readonly stage: Stage; readonly pick: Pick};

/** One scripted agent run: the outcome it hands back. `hold`: it waits for `release` first. */
export interface Step {
	readonly outcome: AnyOutcome;
	readonly hold?: boolean;
}

/** A named pipe: a line of ticket numbers with a name, like a FIFO file. */
interface Fifo {
	readonly queue: Queue.Queue<number, Cause.Done>;
	/** Writers open on it now. When the last one ends, a fifo that `holds` ends for its reader. */
	writers: number;
	/** `true`: Unix's rule, the reader's end waits for the last writer. `false`: the reader ends with its own pipe. */
	readonly holds: boolean;
	reading: boolean;
}

export interface World {
	readonly facts: Fact[];
	readonly appended: PubSub.PubSub<Fact>;
	/** By `stage#ticket`: the runs still to come, first first. */
	readonly script: Map<string, Step[]>;
	/** Every agent run that started, in order: the cost, at $0 each here. */
	readonly runs: {readonly stage: Stage; readonly ticket: number}[];
	/** Tickets told into a named pipe nobody read any more. */
	readonly dropped: {readonly ticket: number; readonly fifo: string}[];
	readonly fifos: Map<string, Fifo>;
	/** Runs that wait at a `hold` step. */
	held: number;
	readonly release: Deferred.Deferred<void>;
	/** Where the children a parent calls keep their machines. */
	readonly storage: Storage;
}

export class Factory extends Context.Service<Factory, World>()("exp168/Factory") {}

export const keyOf = (stage: Stage, ticket: number) => `${stage}#${ticket}`;

/** A world with these facts on its ledger and these runs scripted. */
export const makeWorld = (
	facts: readonly Fact[],
	script: Readonly<Record<string, readonly Step[]>>,
) =>
	Effect.gen(function* () {
		const world: World = {
			facts: [...facts],
			appended: yield* PubSub.unbounded<Fact>(),
			script: new Map(Object.entries(script).map(([k, steps]) => [k, [...steps]])),
			runs: [],
			dropped: [],
			fifos: new Map(),
			held: 0,
			release: yield* Deferred.make<void>(),
			storage: memoryStorage(),
		};
		return world;
	});

const append = (world: World, fact: Fact) =>
	Effect.sync(() => world.facts.push(fact)).pipe(
		Effect.andThen(PubSub.publish(world.appended, fact)),
	);

/** Make a named pipe, as `mkfifo` does. One there already is made again, empty. */
export const mkfifo = (world: World, name: string, holds: boolean) =>
	Effect.gen(function* () {
		world.fifos.set(name, {
			queue: yield* Queue.unbounded<number, Cause.Done>(),
			writers: 0,
			holds,
			reading: false,
		});
	});

// ---------------------------------------------------------------- reading fresh

/** What a stage does with a ticket, read from the ticket's facts before any agent runs. */
export type Look = "run" | "pass" | "wait" | "stop";

const isSendTo = (fact: Fact, ticket: number, stage: Stage) =>
	fact.ticket === ticket &&
	fact.kind === "outcome" &&
	fact.outcome.kind === "send" &&
	fact.outcome.to === stage;

/**
 * The stage's own last word on the ticket decides, unless a `send` to it came after:
 *
 *   none, or a send to me since     run       my agent has work
 *   done, or an ask answered yes    pass      passed on, no agent
 *   an ask with no answer yet       wait      for the answer, no agent
 *   skip, stuck, an ask answered no stop      not passed on
 *   send (I sent it on before)      run       it came back round to me
 */
export function lookOf(facts: readonly Fact[], stage: Stage, ticket: number): Look {
	let at = -1;
	facts.forEach((f, i) => {
		if (f.ticket === ticket && (f.kind === "outcome" || f.kind === "answer") && f.stage === stage)
			at = i;
	});
	const last = facts[at];
	if (last === undefined || facts.some((f, i) => i > at && isSendTo(f, ticket, stage)))
		return "run";
	if (last.kind === "answer") return last.pick === "approve" ? "pass" : "stop";
	if (last.kind !== "outcome") return "run";
	switch (last.outcome.kind) {
		case "done":
			return "pass";
		case "ask":
			return "wait";
		case "skip":
		case "stuck":
			return "stop";
		case "send":
			return "run";
	}
}

/** Tickets the tracker hands out: filed, and not ended (shipped, skipped, stuck, or answered no). */
export const openTickets = (facts: readonly Fact[]): readonly number[] =>
	facts.flatMap((f) => {
		if (f.kind !== "filed") return [];
		const ended = STAGES.some((s) => {
			const look = lookOf(facts, s, f.ticket);
			return look === "stop" || (s === "ship" && look === "pass");
		});
		return ended ? [] : [f.ticket];
	});

// ---------------------------------------------------------------- the stages

/** What a stage says of one ticket, printed for a person and read typed by a parent. */
export const Said = Schema.Struct({
	id: Schema.String,
	stage: Schema.String,
	name: Schema.String,
	kind: Schema.Literals(["done", "send", "ask", "skip", "stuck"]),
	to: Schema.NullOr(Schema.String),
});
export type Said = typeof Said.Type;

/** A person's answer to an ask, told on a stage's `answer` input. */
export const Answer = Schema.Struct({
	ticket: TicketNumber,
	pick: Schema.Literals(["approve", "no"]),
});
export type Answer = typeof Answer.Type;

const FifoName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/));

/** One line per ticket in `jobs`: where the ticket is in this stage. */
const Line = Schema.Struct({line: Schema.String});
const lineMachine = defineMachine({
	types: {
		model: {} as typeof Line.Type,
		msg: {} as {readonly type: "say"; readonly line: string},
		ctx: undefined,
	},
	cmds: [],
	init: (loaded) => [loaded ?? {line: "started"}, []],
	update: {say: (_s, m) => [{line: m.line}, []]},
});
const ticketKind = kind({
	machine: lineMachine,
	state: Line,
	parent: "main",
	options: () => ({ctx: undefined}),
	drawing: () => ({name: "ticket", steps: {}}),
	status: (s) => s.line,
});

const DOES: Readonly<Record<Stage, string>> = {
	triage: "Sorts a ticket: yes goes on to plan, no is skipped.",
	plan: "Plans a ticket and asks its owner to approve the plan; an approved plan goes on to build.",
	build: "Builds a ticket's plan into a commit; a built ticket goes on to review.",
	review: "Reviews a built ticket; red checks send it back to build, a pass goes on to ship.",
	ship: "Ships a reviewed ticket: pushes it, opens its pull request and merges it.",
};

const TICKET = flag(
	Schema.NullOr(TicketNumber),
	"One ticket to start on, by its number, for a stage that no pipe feeds.",
	{default: null},
);
const FROM = flag(
	Schema.NullOr(FifoName),
	"A named pipe (made by mkfifo) to read more tickets from, beside the pipe in.",
	{default: null},
);
const TO = flag(
	Schema.NullOr(FifoName),
	"A named pipe to write a ticket into when this stage sends it back.",
	{default: null},
);
const PLAIN = {ticket: TICKET};
const WITH_FIFOS = {ticket: TICKET, from: FROM, to: TO};

const inputsOf = {
	ticket: input(TicketNumber, "A ticket to work on, by its number."),
	answer: input(Answer, "A person's answer to this stage's ask, for one ticket."),
};
const outputsOf = {
	ticket: output(TicketNumber, "A ticket this stage is done with: the next stage's work."),
	said: output(Said, "What this stage said of a ticket, in the five verbs."),
};

/**
 * One stage: for each ticket, read fresh, run the scripted agent if there is work, and act on its
 * outcome. `fifos`: the stage takes `--from` and `--to` (shapes 1 and 2).
 */
export function stageProgram(stage: Stage, fifos: boolean) {
	return defineProgram({
		name: stage,
		description: DOES[stage],
		// The plain list has no --from or --to; main reads them as null then.
		flags: (fifos ? WITH_FIFOS : PLAIN) as typeof WITH_FIFOS,
		inputs: inputsOf,
		outputs: outputsOf,
		machines: {ticket: ticketKind},
		main: ({flags, inputs, send, machines}) =>
			Effect.gen(function* () {
				const world = yield* Factory;
				const from = flags.from ?? null;
				const to = flags.to ?? null;
				// No Msg to start with: a copy already live is shared, so each say reaches the one copy.
				const say = (n: number, text: string) =>
					machines.ticket
						.get(`#${n}`)
						.start()
						.pipe(
							Effect.flatMap((copy) => copy.dispatch({type: "say", line: `#${n} ${text}`})),
							Effect.orDie,
						);
				const tellSaid = (n: number, o: AnyOutcome) =>
					send("said", {
						id: `#${n}`,
						stage,
						name: nameOf(o),
						kind: o.kind,
						to: o.kind === "send" ? o.to : null,
					});

				// Answers, by ticket: one that comes before its ask waits here for it.
				const early = new Map<number, Pick>();
				const waiting = new Map<number, Deferred.Deferred<Pick>>();
				yield* inputs.answer.pipe(
					Stream.runForEach((a) =>
						Effect.sync(() => {
							const d = waiting.get(a.ticket);
							if (d === undefined) early.set(a.ticket, a.pick);
							else Deferred.doneUnsafe(d, Effect.succeed(a.pick));
						}),
					),
					Effect.forkScoped,
				);
				const answerOf = (n: number) =>
					Effect.gen(function* () {
						const got = early.get(n);
						if (got !== undefined) return got;
						const d = yield* Deferred.make<Pick>();
						waiting.set(n, d);
						return yield* Deferred.await(d);
					});

				const passOn = (n: number, why: string) =>
					say(n, why).pipe(Effect.andThen(send("ticket", n)));

				const waitFor = (n: number) =>
					Effect.gen(function* () {
						const pick = yield* answerOf(n);
						yield* append(world, {kind: "answer", ticket: n, stage, pick});
						if (pick === "approve") yield* passOn(n, "approved: passed on");
						else yield* say(n, "answered no: not passed on");
					});

				const sendBack = (n: number, o: Extract<AnyOutcome, {kind: "send"}>) =>
					Effect.gen(function* () {
						const fifo = to === null ? undefined : world.fifos.get(to);
						if (to === null || fifo === undefined) {
							yield* say(n, `${nameOf(o)}: not passed on here`);
							return;
						}
						if (!fifo.holds && !fifo.reading) {
							world.dropped.push({ticket: n, fifo: to});
							yield* say(n, `${nameOf(o)}: nobody reads ${to} any more, dropped`);
							return;
						}
						const told = Queue.offerUnsafe(fifo.queue, n);
						if (!told) world.dropped.push({ticket: n, fifo: to});
						yield* say(n, told ? `${nameOf(o)}: written to ${to}` : `${to} is closed, dropped`);
					});

				const act = (n: number, o: AnyOutcome) =>
					Effect.gen(function* () {
						yield* append(world, {kind: "outcome", ticket: n, stage, outcome: o});
						yield* tellSaid(n, o);
						switch (o.kind) {
							case "done":
								return yield* passOn(n, "done: passed on");
							case "ask":
								yield* say(n, `${nameOf(o)}: waiting`);
								return yield* waitFor(n);
							case "skip":
							case "stuck":
								return yield* say(n, `${nameOf(o)}: not passed on`);
							case "send":
								return yield* sendBack(n, o);
						}
					});

				const runAgent = (n: number) =>
					Effect.gen(function* () {
						const steps = world.script.get(keyOf(stage, n)) ?? [];
						const [step] = steps;
						world.runs.push({stage, ticket: n});
						yield* say(n, "agent running");
						if (step?.hold === true) {
							world.held += 1;
							yield* Deferred.await(world.release).pipe(
								Effect.ensuring(Effect.sync(() => (world.held -= 1))),
							);
						}
						// Taken off the script only once it is said, so a run stopped mid-way is run again.
						steps.shift();
						const outcome: AnyOutcome = step?.outcome ?? {kind: "stuck", why: "no_script"};
						yield* act(n, outcome);
					});

				const handle = (n: number) =>
					Effect.gen(function* () {
						switch (lookOf(world.facts, stage, n)) {
							case "pass":
								return yield* passOn(n, "already done: passed on");
							case "wait":
								yield* say(n, "still waiting on its ask");
								return yield* waitFor(n);
							case "stop":
								return yield* say(n, "already ended here");
							case "run":
								return yield* runAgent(n);
						}
					});

				let tickets: Stream.Stream<number> = inputs.ticket;
				if (flags.ticket !== null) tickets = Stream.concat(Stream.make(flags.ticket), tickets);
				if (from !== null) {
					const fifo = world.fifos.get(from);
					if (fifo === undefined)
						return yield* Effect.fail({
							_tag: "no_fifo" as const,
							message: `no named pipe ${from}: make it with mkfifo --name ${from}`,
						});
					fifo.reading = true;
					tickets = Stream.merge(tickets, Stream.fromQueue(fifo.queue), {
						haltStrategy: fifo.holds ? "both" : "left",
					}).pipe(Stream.ensuring(Effect.sync(() => (fifo.reading = false))));
				}
				if (to !== null) {
					const fifo = world.fifos.get(to);
					if (fifo === undefined)
						return yield* Effect.fail({
							_tag: "no_fifo" as const,
							message: `no named pipe ${to}: make it with mkfifo --name ${to}`,
						});
					// One writer while this run lives, as a process holds a FIFO open for writing.
					yield* Effect.acquireRelease(
						Effect.sync(() => (fifo.writers += 1)),
						() =>
							Effect.sync(() => {
								fifo.writers -= 1;
								if (fifo.writers === 0 && fifo.holds) Queue.endUnsafe(fifo.queue);
							}),
					);
				}
				yield* tickets.pipe(Stream.mapEffect(handle, {concurrency: "unbounded"}), Stream.runDrain);
			}).pipe(Effect.scoped),
	});
}

/**
 * The line's head: every open ticket, then it waits, as the real tracker listens to the ledger.
 * `loop` (shape 4): a `send` on the ledger hands that ticket out again, so it comes round the line.
 */
export function trackerProgram(loop: boolean) {
	return defineProgram({
		name: "tracker",
		description: loop
			? "Hands out every open ticket, then listens: a ticket a stage sends back is handed out again."
			: "Hands out every open ticket, then listens for new ones.",
		inputs: {},
		outputs: {ticket: output(TicketNumber, "An open ticket, by its number.")},
		main: ({send}) =>
			Effect.gen(function* () {
				const world = yield* Factory;
				const heard = yield* PubSub.subscribe(world.appended);
				for (const n of openTickets(world.facts)) yield* send("ticket", n);
				return yield* Effect.forever(
					PubSub.take(heard).pipe(
						Effect.flatMap((f) =>
							loop && f.kind === "outcome" && f.outcome.kind === "send"
								? send("ticket", f.ticket)
								: Effect.void,
						),
					),
				);
			}).pipe(Effect.scoped),
	});
}

/** `mkfifo --name redo`: shape 1's named pipe, made before the line that uses it. */
export const mkfifoProgram = defineProgram({
	name: "mkfifo",
	description: "Makes a named pipe: a stage reads it with --from and writes it with --to.",
	flags: {name: flag(FifoName, "The pipe's name.")},
	inputs: {},
	outputs: {},
	main: ({flags}) =>
		Effect.gen(function* () {
			yield* mkfifo(yield* Factory, flags.name, true);
		}),
});

/**
 * Shape 3: one program that holds the loop, the Elm answer. It calls build, then review, as its
 * children, for each ticket; review's `send:build` starts the next lap, up to `--laps`. The lap is
 * counted from the ledger, so a Ctrl-C does not hand a ticket fresh laps.
 */
export function buildReviewProgram(
	build: ReturnType<typeof stageProgram>,
	review: ReturnType<typeof stageProgram>,
) {
	return defineProgram({
		name: "build-review",
		description:
			"Builds a ticket, then has it reviewed; a review that sends it back to build starts the next lap, up to --laps laps. A pass goes on.",
		flags: {
			ticket: TICKET,
			laps: flag(
				Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
				"The most laps a ticket gets.",
				{
					default: 3,
				},
			),
		},
		inputs: {ticket: inputsOf.ticket},
		outputs: outputsOf,
		machines: {ticket: ticketKind},
		main: ({flags, inputs, send, machines}) =>
			Effect.gen(function* () {
				const world = yield* Factory;
				const say = (n: number, text: string) =>
					machines.ticket
						.get(`#${n}`)
						.start()
						.pipe(
							Effect.flatMap((copy) => copy.dispatch({type: "say", line: `#${n} ${text}`})),
							Effect.orDie,
						);
				let calls = 0;
				/** One child run on one ticket: what it said, and whether it passed the ticket on. */
				const child = (program: typeof build, n: number) =>
					Effect.gen(function* () {
						calls += 1;
						const called = yield* call(
							program,
							// Shape 3's stages take --ticket alone; the fifo flags are shapes 1 and 2's.
							{ticket: null} as never,
							{
								told: {ticket: [n]},
								keeping: {id: `${program.name}:${n}:${calls}`, storage: world.storage},
							},
						);
						if (called.kind !== "called") return {passed: false, said: [] as Said[]};
						const said = called.heard.flatMap((h) => (h.name === "said" ? [h.value as Said] : []));
						for (const s of said) yield* send("said", s);
						return {passed: called.heard.some((h) => h.name === "ticket"), said};
					});
				const lapsOf = (n: number) =>
					world.facts.filter(
						(f) => isSendTo(f, n, "build") && f.kind === "outcome" && f.stage === "review",
					).length;
				const one = (n: number) =>
					Effect.gen(function* () {
						for (;;) {
							const lap = lapsOf(n) + 1;
							if (lap > flags.laps)
								return yield* say(n, `stuck:laps: ${flags.laps} laps, not passed on`);
							yield* say(n, `lap ${lap}: in build`);
							const built = yield* child(build, n);
							if (!built.passed) return yield* say(n, `lap ${lap}: build did not pass it on`);
							yield* say(n, `lap ${lap}: in review`);
							const reviewed = yield* child(review, n);
							if (reviewed.passed) {
								yield* say(n, `lap ${lap}: passed review, passed on`);
								return yield* send("ticket", n);
							}
							if (!reviewed.said.some((s) => s.kind === "send" && s.to === "build"))
								return yield* say(n, `lap ${lap}: review did not pass it on`);
						}
					});
				let tickets: Stream.Stream<number> = inputs.ticket;
				if (flags.ticket !== null) tickets = Stream.concat(Stream.make(flags.ticket), tickets);
				yield* tickets.pipe(Stream.mapEffect(one, {concurrency: "unbounded"}), Stream.runDrain);
			}).pipe(Effect.scoped),
	});
}

// ---------------------------------------------------------------- the shapes

export type ShapeName = "fifo" | "back" | "parent" | "tracker";

/** The program list of one shape, every program handed the one world. */
export function listOf(shape: ShapeName, world: World): Shell.ProgramList {
	const layer = Layer.succeed(Factory, world);
	const fifos = shape === "fifo" || shape === "back";
	const stages = Object.fromEntries(STAGES.map((s) => [s, stageProgram(s, fifos)])) as Record<
		Stage,
		ReturnType<typeof stageProgram>
	>;
	const entries: Entry[] = [
		listed(trackerProgram(shape === "tracker"), layer),
		...STAGES.map((s) => listed(stages[s], layer)),
	];
	if (shape === "fifo") entries.push(listed(mkfifoProgram, layer));
	if (shape === "parent")
		entries.push(listed(buildReviewProgram(stages.build, stages.review), layer));
	return Shell.programList([...Shell.SMALL, ...entries]);
}

/** Who may send a ticket back to whom: the stages' own words (docs/direction/outcome-names.md). */
export const SENDS: Readonly<Partial<Record<Stage, readonly Stage[]>>> = {
	review: ["build"],
	ship: ["build"],
};

let loops = 0;
/**
 * Shape 2, done inside the experiment as sugar over shape 1: `review ^build` on a line becomes a
 * named pipe of the line's own, written by review and read by build. A real tsh would keep the
 * typed text and add the wire back to the job's record; this one hands tsh the rewritten line.
 * Answers the line tsh is told, or why it is refused.
 */
export const backWires = (world: World, line: string, holds: boolean) =>
	Effect.gen(function* () {
		const statements = line.split(";");
		const out: string[] = [];
		for (const statement of statements) {
			const parts = statement.split("|").map((p) => p.trim());
			const names = parts.map((p) => p.split(/\s+/)[0] ?? "");
			const rewritten = [...parts];
			for (const [i, part] of parts.entries()) {
				const marks = [...part.matchAll(/\^([a-z][a-z0-9-]*)/g)];
				for (const mark of marks) {
					const target = mark[1] ?? "";
					const from = names[i] as Stage;
					const at = names.slice(0, i).lastIndexOf(target);
					if (at < 0)
						return {
							kind: "refused" as const,
							why: `^${target}: no ${target} before ${from} on this line`,
						};
					if (!(SENDS[from] ?? []).includes(target as Stage))
						return {
							kind: "refused" as const,
							why: `^${target}: ${from} never sends a ticket to ${target}`,
						};
					loops += 1;
					const fifo = `loop-${loops}`;
					yield* mkfifo(world, fifo, holds);
					rewritten[i] = (rewritten[i] ?? "").replace(mark[0], `--to ${fifo}`);
					rewritten[at] = `${rewritten[at]} --from ${fifo}`;
				}
			}
			out.push(rewritten.join(" | "));
		}
		return {kind: "line" as const, line: out.join("; ")};
	});

// ---------------------------------------------------------------- the shell

/** One tsh, in this process, on a fresh job storage, with this program list. */
export const session = (list: Shell.ProgramList) =>
	Effect.gen(function* () {
		const printed = ear<Shell.Printed>();
		const ready = ear<Shell.Ready>();
		const storage = memoryStorage();
		const started = yield* start(
			Shell.tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:exp-168", storage},
		).pipe(
			Effect.provideService(Shell.JobStorage, storage),
			Effect.provideService(Shell.Programs, list),
		);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		/** Type a line; answer once its prompt is back. */
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				yield* tell(started.run, "line", text);
				told += 1;
				const all = yield* ready.upTo(told);
				return {
					status: all[told - 1]?.status ?? -1,
					out: printed.values.slice(from).map((p) => p.text),
				};
			});
		/** Type a line and do not wait: a foreground line that may never end. Answers how to wait for it. */
		const typeOnly = (text: string) =>
			Effect.gen(function* () {
				yield* tell(started.run, "line", text);
				told += 1;
				const n = told;
				return {
					ended: (ms: number) =>
						ready.upTo(n).pipe(
							Effect.map((all) => all[n - 1]?.status ?? -1),
							Effect.timeoutOption(Duration.millis(ms)),
						),
				};
			});
		const ctrlC = tell(started.run, "signal", "interrupt");
		/** The job table as tsh holds it now: what a map of a job is drawn from. */
		const table = () => started.run.machines.jobs.state();
		const since = (from: number) => printed.values.slice(from).map((p) => p.text);
		const mark = () => printed.values.length;
		const close = () =>
			Effect.gen(function* () {
				started.close("line");
				yield* started.run.ended;
			});
		return {line, typeOnly, ctrlC, table, since, mark, close};
	});

/** Wait until `until` holds, checking every 2 ms, for at most `ms`. Answers whether it came. */
export const waitUntil = (until: () => boolean, ms = 3000) =>
	Effect.gen(function* () {
		for (;;) {
			if (until()) return true;
			yield* Effect.sleep(Duration.millis(2));
		}
	}).pipe(
		Effect.timeoutOption(Duration.millis(ms)),
		Effect.map((o) => o._tag === "Some"),
	);
