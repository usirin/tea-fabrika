import {Cause, Deferred, Effect, Exit, Option, PubSub, Random, Scope} from "effect";
import type {JobTable} from "../host/host-jobs.ts";
import type {Job, JobsMsg, Owner, StageRecord} from "../host/jobs.ts";
import type {JobEnd} from "../host/traces.ts";
import {writerOf} from "../host/writer.ts";
import type {AnyRunning, Entry} from "../program/listed.ts";
import type {TableView} from "../program/person.ts";
import {type Ended, type Listeners, type Unread, viewOf} from "../program/program.ts";
import type {Input} from "../program/shape.ts";
import {StateRefused, type Storage} from "../program/storage.ts";
import {ATTR, SERVICE_NAME, traceOf} from "../program/trace.ts";
import type {Line, Source, Stage} from "./check.ts";
import {type ProgramList, statusOf, statusOfJob} from "./programs.ts";
import {type Show, shown} from "./short.ts";
import type {SummonManager} from "./summon.ts";
import {type Table, tableOf} from "./table.ts";
import {attachTitleOf, Shorten, titleOf} from "./title.ts";

// What tsh does with a checked line: start its programs, wire them, tell them
// the values on the line, and either wait (a foreground line, Ctrl-C stops
// it) or hand the prompt back (a job). Every program run is a job in the
// table first, under a run id picked here, so `ps` sees it and a tsh started
// again finds it.
//
//   seq --to 3                 `call`: start, close its inputs, wait, print each value
//   seq --to 3 | double        `start` double, `pipe` seq into it, close what no pipe feeds, wait for both
//   tally &                    `start`, keep its inputs open, print `[1] tally:…`, prompt back
//   double n=$(seq --to 2)     run the $( ) first, as a foreground line, and tell double what it sent
//   counter                    a program with a window: `start`, keep its inputs open, wait
//
// A program with a window (`viewOf`) keeps its inputs open in the foreground too: its window
// tells them, the way a terminal feeds a foreground program's stdin. tsh waits for its end, or
// for Ctrl-C, as for any foreground job.

/** What tsh holds while it runs: handed to everything that runs a line. */
export interface Shell {
	readonly list: ProgramList;
	/** Where the host keeps its jobs' runs. */
	readonly storage: Storage;
	/** The host's job table: tsh reads it and sends it Msgs, and never keeps a copy. */
	readonly table: JobTable;
	/** Whom this tsh is for: each job it begins or attaches is this owner's in the table. */
	readonly owner: Owner;
	/** Who this tsh writes as: each job it begins is theirs, and each stop it asks says them. */
	readonly by: string | null;
	/** A line to show; `n`: the job it was printed for, so a host keeps a job's lines (Printed's `n`). */
	readonly print: (to: "out" | "err", text: string, n?: number) => void;
	/** A table for a person, on out: its terminal lays it out (./table.ts). `n`: the job that printed it; none for tsh's own. */
	readonly printTable: (table: Table, n?: number) => void;
	/** How a value a program sends is printed: short for a person, or its JSON whole. */
	readonly show: Show;
	/** Ctrl-C, as it comes. Heard by the foreground wait only. */
	readonly signals: PubSub.PubSub<"interrupt">;
	/** The starter's handle of each run this tsh started, by run id. */
	readonly live: Map<string, AnyRunning>;
	/**
	 * The stop of each job this tsh began or attached, by the run id of its first stage. Set before
	 * its job is in the table and kept until it ends, so a stop that finds the job finds this too,
	 * even before tsh holds its runs (`live`).
	 */
	readonly stops: Map<string, JobStop>;
	/** Each job's ends, once the table has heard them, by the run id of its first stage: what a foreground wait waits on. */
	readonly watched: Map<string, Watcher>;
	/** tsh's own scope: a job's scope is made under it, so every job stops when tsh does. */
	readonly scope: Scope.Scope;
	/** The agents summoned on this host: what `summon`, `dismiss`, `agents` and `@name` speak to. */
	readonly summons: SummonManager["Service"];
	/** Job n's line shown in place (an output's `status` form); `null`: none any more. */
	readonly status: (n: number, text: string | null) => void;
	/**
	 * Job n waits on a yes or no (an output's `ask` form): what it asks, and the run and input the
	 * answer goes to. `null`: nothing waits any more.
	 */
	readonly ask: (n: number, asking: Asking | null) => void;
	/** Job n printed a line a screen reader is told too (a `line` form with `announce`). */
	readonly announce: (n: number, text: string) => void;
}

/** A yes or no a job waits on: its question, and where the person's answer is told. */
export interface Asking {
	readonly id: string;
	readonly text: string;
	readonly run: string;
	readonly input: string;
}

/** Every end of a job's runs, once the job table has heard each. */
export type Watcher = Deferred.Deferred<readonly Ended<unknown>[]>;

/**
 * One job's stop. `asked`: a stop was asked of it, said to the table and in the tile, so a second
 * stop asks nothing again. `go`: done once it was said: a `call` (a one-program line in the
 * foreground, with no handle) stops on it, as on Ctrl-C, and a job whose runs were still starting
 * stops as soon as tsh holds them.
 */
export interface JobStop {
	asked: boolean;
	readonly go: Deferred.Deferred<void>;
}

/** A job's stop, kept in `Shell.stops` under its first run id until `ends` is done. */
const keepStop = (shell: Shell, run: string) =>
	Effect.map(Deferred.make<void>(), (go) => {
		const stop: JobStop = {asked: false, go};
		shell.stops.set(run, stop);
		return stop;
	});

/** The runs of a job whose stop was asked while they were starting: stopped now tsh holds them. */
const stopIfAsked = (stop: JobStop, runs: readonly AnyRunning[]) =>
	Deferred.isDoneUnsafe(stop.go)
		? Effect.forEach(runs, (r) => r.stop, {concurrency: "unbounded", discard: true})
		: Effect.void;

/** How a line ended, as a shell's exit status, and the values a `$( )` took. */
interface Done {
	readonly status: number;
	readonly values: readonly unknown[];
}

/** How a line is run. `capture`: a `$( )`; the values its last stage sends on `output` are taken, not printed. */
type Mode =
	| {readonly kind: "foreground"; readonly typed: string}
	| {readonly kind: "background"; readonly typed: string}
	| {readonly kind: "capture"; readonly output: string};

const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

const note = (shell: Shell, msg: JobsMsg) => shell.table.dispatch(msg).pipe(Effect.ignore);

/**
 * This tsh's writer asks job n to stop, as a person does with Ctrl-C or `stop %n`: no why. Said
 * to the table before the runs are stopped, so the job's record keeps who stopped it. A tsh with
 * no writer says nothing: who asked is not known.
 */
const askStop = (shell: Shell, n: number) =>
	shell.by === null ? Effect.void : note(shell, {type: "stopping", n, by: shell.by, why: null});

/**
 * Say who stopped job n, when it was not this tsh's own writer: the host asked for an agent first
 * (its `stopping`, kept once), then told this tsh. Said in the tile the job ran in, where the
 * person was looking.
 *
 *   [3] stopped by agent:claude for:github:7: wrong ticket
 */
const sayStopper = (shell: Shell, n: number) => {
	const stop = shell.table.getState().jobs.find((job) => job.n === n)?.stop ?? null;

	if (stop === null || stop.by === shell.by) {
		return;
	}

	shell.print("err", `[${n}] stopped by ${stop.by}${stop.why === null ? "" : `: ${stop.why}`}`, n);
};

/**
 * Stop job n, as `stop %n` does and as tsh's `stop` input does for the host: a detached job is
 * dropped; one this tsh runs is stopped with its starter's stop, in the foreground or not, or as
 * soon as tsh holds its runs; another tile's runs nowhere here, so nothing is stopped, and no stop
 * is kept. Who asked comes first, so the job's record keeps it with its end (host/records.ts). A
 * job stopped already is not asked again: its stopper is said once.
 */
export const stopJob = (shell: Shell, job: Job) =>
	Effect.gen(function* () {
		if (job.state === "detached") {
			yield* askStop(shell, job.n);
			sayStopper(shell, job.n);
			yield* note(shell, {type: "dropped", n: job.n});
			shell.print("err", `[${job.n}] dropped  ${job.text}`);
			return;
		}

		const stop = shell.stops.get(job.stages[0].run);

		if (stop === undefined || stop.asked) {
			return;
		}

		// Marked before the first yield: the host's stop and a `stop %n` run side by side, and the
		// second must find this one already asked, or both say the stopper.
		stop.asked = true;
		yield* askStop(shell, job.n);
		sayStopper(shell, job.n);
		yield* Deferred.succeed(stop.go, undefined);
		const runs = job.stages.flatMap((s) => {
			const r = shell.live.get(s.run);
			return r === undefined ? [] : [r];
		});
		yield* Effect.forEach(runs, (r) => r.stop, {concurrency: "unbounded", discard: true});
	});

/** What tsh says of a job whose kept state its machine's schema refuses. */
export const SAVED_BY_OLDER_CODE = "this job was saved by older code, can't open it";

/** A failure, or one it was caused by, is a kept state its schema refused. */
const isRefusal = (failure: unknown): boolean => {
	let at = failure;

	for (let depth = 0; depth < 8 && typeof at === "object" && at !== null; depth++) {
		if (at instanceof StateRefused) {
			return true;
		}

		at = "cause" in at ? at.cause : undefined;
	}

	return false;
};

/**
 * A run that ended because one of its machines kept a state its schema
 * refuses: older code saved it. Its program declared the failure or died of
 * it; either way the run never booted that machine, and wrote nothing over it.
 */
const refusedEnd = (ended: Ended<unknown>): boolean =>
	ended.kind === "failed" &&
	ended.cause.reasons.some((reason) =>
		Cause.isFailReason(reason)
			? isRefusal(reason.error)
			: Cause.isDieReason(reason) && isRefusal(reason.defect),
	);

/** One line of why a run failed: its declared failure as the program sent it, or a defect's first line. */
const whyOf = (ended: Ended<unknown>): string => {
	if (ended.kind !== "failed") {
		return ended.kind;
	}

	const declared = Cause.findErrorOption(ended.cause);

	if (Option.isSome(declared)) {
		return `failed: ${inWords(declared.value)}`;
	}

	const first = Cause.pretty(ended.cause).split("\n")[0] ?? "a defect";
	return `failed: ${first.replace(/^Error: /, "")}`;
};

/**
 * A declared failure in words: its `message` when it has one, else its tag
 * with the underscores as spaces (`read_failed`: read failed), else as JSON.
 */
const inWords = (failure: unknown): string => {
	if (typeof failure !== "object" || failure === null) {
		return show(failure);
	}

	const {message, _tag} = failure as {readonly message?: unknown; readonly _tag?: unknown};

	if (typeof message === "string" && message !== "") {
		return message;
	}

	if (typeof _tag === "string") {
		return _tag.replaceAll("_", " ");
	}

	return show(failure);
};

/** A fresh run id: the program's name and 8 random hex digits, from Effect's Random. */
export const runIdOf = (program: string): Effect.Effect<string> =>
	Random.nextIntBetween(0, 0xffffffff).pipe(
		Effect.map((n) => `${program}:${n.toString(16).padStart(8, "0")}`),
	);

/** The values a stage starts with: each source read, a `$( )` run first. `null`: a `$( )` did not end well. */
const valuesOf = (shell: Shell, stage: Stage) =>
	Effect.gen(function* () {
		const read = (source: Source, label: string) =>
			Effect.gen(function* () {
				if (source.kind === "value") {
					return {ok: true as const, values: [source.value]};
				}

				const done = yield* runLine(shell, source.line, {kind: "capture", output: source.output});

				if (done.status !== 0) {
					shell.print(
						"err",
						`tsh: the $( ) for ${label} ended with status ${done.status}; nothing after it ran`,
					);
					return {ok: false as const, status: done.status};
				}

				return {ok: true as const, values: done.values};
			});
		const flags: Record<string, unknown> = {};

		for (const {name, source} of stage.flags) {
			const got = yield* read(source, `--${name}`);

			if (!got.ok) {
				return {ok: false as const, status: got.status};
			}

			const [only, ...more] = got.values;

			if (got.values.length !== 1 || only === undefined || more.length > 0) {
				shell.print(
					"err",
					`tsh: --${name} takes one value, and its $( ) sent ${got.values.length}`,
				);
				return {ok: false as const, status: 2};
			}

			const why = stage.entry.program.flags[name]?.shape.problem(only);

			if (why !== undefined) {
				shell.print("err", `tsh: --${name} does not take what its $( ) sent: ${why}`);
				return {ok: false as const, status: 2};
			}

			flags[name] = only;
		}

		const told: Record<string, unknown[]> = {};

		for (const {name, source} of stage.told) {
			const got = yield* read(source, name);

			if (!got.ok) {
				return {ok: false as const, status: got.status};
			}

			for (const value of got.values) {
				const why = stage.entry.program.inputs[name]?.shape.problem(value);

				if (why !== undefined) {
					shell.print("err", `tsh: ${name} does not take what its $( ) sent: ${why}`);
					return {ok: false as const, status: 2};
				}
			}

			told[name] = [...(told[name] ?? []), ...got.values];
		}

		return {ok: true as const, flags, told};
	});

/** Who prints a stage's outputs, and the tables it holds until the stage's run ends. */
interface Printers {
	readonly listeners: Listeners<any>;
	/**
	 * Print each table its values filled, once the run has ended. `ok`: it ended well, so a table
	 * with no rows is printed too, and says 0; a run that failed before its first row prints none.
	 */
	readonly flush: (ok: boolean) => void;
}

/** Where a stage prints: its job, its run, and the command as typed, for a table's hint. */
interface PrintAt {
	readonly n: number;
	readonly run: string;
	readonly background: boolean;
	readonly stages: number;
	/** `--all`: a table shows every row. */
	readonly all: boolean;
	readonly typed: string;
}

/**
 * Who prints a stage's outputs: every output but the one a pipe or a `$( )` takes, each as its
 * declaration says a person reads it (../program/person.ts):
 *
 *   no person form    tsh's short form, after the output's name when the program has several
 *   a line            the program's own line, and nothing before it but a background job's [n]
 *   a table           its rows held, and printed as one table when the run ends
 *   a status          shown in place on tsh's `status`, never printed, and gone when the run ends
 *   an ask            printed with `allow? [y/N]`, and said on tsh's `asked` until it is over
 *   "none"            nothing: it is for a pipe or a window
 *
 * A line or a table is the program's answer in a person's form: when a pipe or a `$( )` takes
 * another output of the run, the answer went there, and neither is printed. On `tsh --json` every
 * output is printed whole, as before, whatever its person form.
 */
function printers(
	shell: Shell,
	entry: Entry,
	at: PrintAt,
	skip: string | null,
	taken: ((value: unknown) => void) | null,
): Printers {
	const {outputs} = entry.program;
	const names = Object.keys(outputs);
	const job = at.background ? `[${at.n}] ` : "";
	const prefix = (output: string) =>
		`${job}${at.stages > 1 ? `${entry.program.name} ` : ""}${names.length > 1 ? `${output} ` : ""}`;
	const tables: {readonly view: TableView<unknown>; rows: unknown[]}[] = [];
	let showing = false;
	const asking: Asking[] = [];
	const showAsk = () => {
		const next = asking[0];

		if (next !== undefined) {
			shell.print("out", `${job}${next.text}  allow? [y/N]`, at.n);
		}

		shell.ask(at.n, next ?? null);
	};
	const listenerOf = (output: string): ((value: unknown) => void) => {
		if (output === skip) {
			return (value) => taken?.(value);
		}

		const person = outputs[output]?.person;

		if (shell.show === "json" || person === undefined) {
			return (value) => shell.print("out", `${prefix(output)}${shown(value, shell.show)}`, at.n);
		}

		if (person === "none" || skip !== null) {
			return () => {};
		}

		if ("line" in person) {
			return (value) => {
				const text = person.line(value);
				shell.print("out", `${job}${text}`, at.n);

				if (person.announce === true) {
					shell.announce(at.n, text);
				}
			};
		}

		if ("status" in person) {
			return (value) => {
				showing = true;
				shell.status(at.n, person.status(value));
			};
		}

		if ("ask" in person) {
			return (value) => {
				const question = person.ask(value);

				if (question.text === null) {
					const index = asking.findIndex((a) => a.id === question.id);

					if (index === -1) {
						return;
					}

					asking.splice(index, 1);

					if (index === 0) {
						showAsk();
					}

					return;
				}

				if (asking.some((a) => a.id === question.id)) {
					return;
				}

				asking.push({...question, run: at.run, input: person.answer});

				if (asking.length === 1) {
					showAsk();
				}
			};
		}

		const table = {view: person.table, rows: [] as unknown[]};
		tables.push(table);
		return (value) => table.rows.push(value);
	};
	return {
		listeners: Object.fromEntries(names.map((output) => [output, listenerOf(output)])),
		flush: (ok) => {
			// The run is over: what it showed in place goes, and nothing waits on an answer.
			if (showing) {
				shell.status(at.n, null);
			}

			showing = false;

			if (asking.length > 0) {
				shell.ask(at.n, null);
			}

			asking.length = 0;

			for (const table of tables) {
				if (ok || table.rows.length > 0) {
					shell.printTable(tableOf(table.view, table.rows, {all: at.all, typed: at.typed}), at.n);
				}

				// Printed once: a second end said of the same run prints nothing more.
				table.rows = [];
			}

			tables.length = 0;
		},
	};
}

/** One stage to start: its entry, record, values, and whether its inputs close once told. */
interface Starting {
	readonly entry: Entry;
	readonly record: StageRecord;
	readonly told: Readonly<Record<string, readonly unknown[]>>;
	readonly fed: string | null;
	readonly listeners: Listeners<any>;
	readonly flush: Printers["flush"];
}

/** Print the tables of a job's stages, each once its run has ended. */
const flushAll = (stages: readonly Starting[], ends: readonly Ended<unknown>[]) =>
	Effect.sync(() => {
		for (const [i, stage] of stages.entries()) {
			stage.flush(ends[i]?.kind === "ended");
		}
	});

/**
 * Start the stages of a job, the last first, so each pipe has its downstream
 * running before its upstream starts. `close`: close every input no pipe
 * feeds once its values are told, like a foreground command's stdin at its
 * end, but not those of a program with a window, which its window tells, nor
 * an input only a person tells, which the person answers while the job runs.
 * Answers the handles in stage order, or why one did not start.
 */
const startStages = (shell: Shell, stages: readonly Starting[], close: boolean) =>
	Effect.gen(function* () {
		const runs: AnyRunning[] = [];
		let downstream: AnyRunning | undefined;

		for (const stage of [...stages].reverse()) {
			const {entry, record} = stage;
			const keeping = {id: record.run, storage: shell.storage};
			const started =
				record.wire === null || downstream === undefined
					? yield* entry.start(record.flags, stage.listeners, keeping)
					: yield* entry.pipe(
							record.flags,
							stage.listeners,
							keeping,
							record.wire.output,
							downstream,
							record.wire.input,
						);

			if (started.kind !== "running") {
				return {
					ok: false as const,
					runs,
					why: `${entry.program.name} did not start: ${started.kind === "bad_shape" ? `${started.name}: ${started.why}` : "its pipe does not fit"}`,
				};
			}

			runs.unshift(started);
			downstream = started;

			// Told before any upstream starts, so never waited for: a full line, or a word but `queued`, stops the job here.
			for (const [name, values] of Object.entries(stage.told)) {
				for (const value of values) {
					const word = yield* started.run
						.tell(name, value)
						.pipe(
							Effect.catchTag("MailboxFull", (full) =>
								Effect.succeed(`full: its mailbox holds ${full.capacity} values`),
							),
						);

					if (word !== "queued") {
						return {
							ok: false as const,
							runs,
							why: `${entry.program.name} did not take its ${name}: it answered ${word}`,
						};
					}
				}
			}

			if (close && viewOf(entry.program) === undefined) {
				for (const [name, declared] of Object.entries<Input<unknown>>(entry.program.inputs)) {
					if (name !== stage.fed && !declared.personOnly) {
						started.close(name);
					}
				}
			}
		}

		return {ok: true as const, runs};
	});

/**
 * Wait for a job (by its watcher, so the table already says it ended), or for
 * Ctrl-C, which stops every run with its starter's `stop`. Answers each run's end.
 */
const waitFor = (shell: Shell, n: number, runs: readonly AnyRunning[], watcher: Watcher) =>
	Effect.gen(function* () {
		const signal = yield* PubSub.subscribe(shell.signals);
		const stopped = PubSub.take(signal).pipe(
			Effect.andThen(askStop(shell, n)),
			Effect.andThen(Effect.forEach(runs, (r) => r.stop, {concurrency: "unbounded"})),
			Effect.andThen(Deferred.await(watcher)),
		);
		return yield* Effect.raceFirst(Deferred.await(watcher), stopped);
	}).pipe(Effect.scoped);

/**
 * Tell the table each run's end, as it comes, and close the job's scope after
 * the last. Its fiber answers every end once the table has heard them all, so
 * whoever waits on it never sees a job end that the table does not show.
 *
 * A run whose kept state its schema refuses (`refusedEnd`) is not an end the
 * job leaves the table by: the rest of the job stops, since it cannot go on
 * without that run, and the job stays in the table, detached, as it was. So a
 * job saved by older code is never dropped by tsh, and a person drops it with
 * `stop %n`.
 */
const watchEnds = (
	shell: Shell,
	runs: readonly AnyRunning[],
	jobScope: Scope.Closeable,
	after: (ends: readonly Ended<unknown>[]) => Effect.Effect<void>,
) =>
	Effect.gen(function* () {
		const [first] = runs;
		const watcher: Watcher = yield* Deferred.make<readonly Ended<unknown>[]>();

		// In the map before the fiber starts, so the fiber's own leaving always finds it there.
		if (first !== undefined) {
			shell.watched.set(first.run.id, watcher);
		}

		const stopAll = Effect.forEach(runs, (r) => r.stop, {concurrency: "unbounded", discard: true});
		yield* Effect.forEach(
			runs,
			(r) =>
				r.run.ended.pipe(
					Effect.tap((ended) =>
						Effect.sync(() => shell.live.delete(r.run.id)).pipe(
							Effect.andThen(
								refusedEnd(ended)
									? stopAll
									: note(shell, {type: "stage_ended", run: r.run.id, how: jobEnd(ended)}),
							),
						),
					),
				),
			{concurrency: "unbounded"},
		).pipe(
			Effect.tap((ends) =>
				first !== undefined && ends.some(refusedEnd)
					? note(shell, {type: "detached", n: numberOf(shell, first.run.id)})
					: Effect.void,
			),
			Effect.tap(after),
			Effect.tap(() => Scope.close(jobScope, Exit.void)),
			Effect.flatMap((ends) => Deferred.succeed(watcher, ends)),
			Effect.ensuring(
				Effect.sync(() => {
					if (first === undefined) {
						return;
					}

					shell.watched.delete(first.run.id);
					shell.stops.delete(first.run.id);
				}),
			),
			Effect.forkIn(shell.scope),
		);
		return watcher;
	});

/** How a run ended, in the words a job's record keeps. */
const jobEnd = (ended: Ended<unknown>): JobEnd => (ended.kind === "ended" ? "done" : ended.kind);

/** The job's number in the table, found by the run id of its first stage. */
const numberOf = (shell: Shell, run: string): number =>
	shell.table.getState().jobs.find((job) => job.stages[0].run === run)?.n ?? 0;

/**
 * Say a job ended, and why each of its stages did, under the job's number: a
 * job leaves the table with its reason said, never in silence. A stage that
 * ended on its own names the inputs its starter closed, read from its record.
 *
 *   [1] ended  build --model m ticket=... & close %1 ticket
 *   [1] build ended: its input ticket was closed, and it finished all it held
 *
 * A stage that left values on its lines says how many, never "all it held"
 * (experiment 80): `[2] lazy ended: its input n was closed, and it stopped
 * reading, with 5 told on n never read`.
 */
const sayJobEnd = (
	shell: Shell,
	n: number,
	text: string,
	runs: readonly AnyRunning[],
	ends: readonly Ended<unknown>[],
) =>
	Effect.gen(function* () {
		if (ends.some(refusedEnd)) {
			shell.print("err", `[${n}] ${SAVED_BY_OLDER_CODE}  ${text}`, n);
			shell.print("err", `[${n}] it stays in the table, detached; stop %${n} drops it`, n);
			return;
		}

		const status = statusOfJob(ends);
		shell.print("err", `[${n}] ${status === 0 ? "ended" : `ended ${status}`}  ${text}`, n);

		for (const [i, r] of runs.entries()) {
			const ended = ends[i];

			if (ended === undefined) {
				continue;
			}

			const name = r.run.program.name;
			const left = unreadWords(ended.unread);

			if (ended.kind !== "ended") {
				shell.print(
					"err",
					`[${n}] ${name} ${whyOf(ended)}${left === null ? "" : `, with ${left}`}`,
					n,
				);
				continue;
			}

			const record = yield* shell.storage.record(r.run.id).pipe(Effect.orElseSucceed(() => null));
			shell.print("err", `[${n}] ${name} ended: ${onItsOwn(record?.closed ?? [], left)}`, n);
		}
	});

/** What a run left on its inputs' lines, in words: `5 told on n never read`. `null`: it read all it was told. */
const unreadWords = (unread: Unread): string | null => {
	const left = Object.entries(unread).map(([input, n]) => `${n} told on ${input}`);
	return left.length === 0 ? null : `${left.join(", ")} never read`;
};

/** Why a stage ended on its own, by the inputs its starter closed, and what it left unread. */
const onItsOwn = (closed: readonly string[], left: string | null): string => {
	if (closed.length === 0) {
		return left === null ? "it had nothing left to do" : `it stopped reading, with ${left}`;
	}

	const inputs =
		closed.length === 1 ? `its input ${closed[0]} was` : `its inputs ${closed.join(", ")} were`;
	return left === null
		? `${inputs} closed, and it finished all it held`
		: `${inputs} closed, and it stopped reading, with ${left}`;
};

/** Whether a program has an output whose line says how its run ended (a `line` form's `ends`). */
const saysItsEnd = (program: Entry["program"] | undefined): boolean =>
	program !== undefined &&
	Object.keys(program.outputs).some((name) => {
		const person = program.outputs[name]?.person;
		return typeof person === "object" && "line" in person && person.ends === true;
	});

/** Say how foreground job `n` ended, when it did not end well: on err, like a shell. */
const sayEnd = (
	shell: Shell,
	n: number,
	text: string,
	ends: readonly Ended<unknown>[],
	names: readonly string[],
) => {
	ends.forEach((ended, i) => {
		if (ended.kind === "failed") {
			shell.print("err", `tsh: ${names[i] ?? "?"} ${whyOf(ended)}`, n);
		}

		const left = unreadWords(ended.unread);

		if (left !== null) {
			shell.print("err", `tsh: ${names[i] ?? "?"} ended with ${left}`, n);
		}
	});
	// A stopped stage whose program says how it ended, a stop included, said it already.
	const unsaid = ends.some(
		(e, i) => e.kind === "stopped" && !saysItsEnd(shell.list.get(names[i] ?? "")?.program),
	);

	if (unsaid) {
		shell.print("err", `[stopped] ${text}`, n);
	}
};

/**
 * Run a checked line. A line typed (not a `$( )`) is one trace: its root span
 * is named by what ran (./title.ts), in the trace its first run's id names,
 * so the job's runs, its `$( )`s and an `attach` of it after a kill are all
 * in it.
 */
export const runLine = (shell: Shell, line: Line, mode: Mode): Effect.Effect<Done> =>
	Effect.gen(function* () {
		const runs = yield* Effect.forEach(
			line.stages,
			(stage) => runIdOf(stage.entry.program.name).pipe(Effect.map((run) => ({stage, run}))),
			{concurrency: 1},
		);
		const [first] = runs;
		const body = runStages(shell, line, mode, runs);

		if (mode.kind === "capture" || first === undefined) {
			return yield* body;
		}

		const short = yield* Shorten;
		return yield* body.pipe(Effect.withSpan(titleOf(line, short), lineSpan(first.run, mode.typed)));
	});

/**
 * The root span of a line typed at tsh: in the trace its job's first run id
 * names, with the line as typed kept beside its name. It is the one span a
 * value may be on: the line holds what was told on it.
 */
export const lineSpan = (first: string, typed: string) => ({
	parent: traceOf(first),
	kind: "server" as const,
	attributes: {[ATTR.run]: first, [ATTR.line]: typed, [SERVICE_NAME]: "tsh"},
});

/** A program with an input only a person tells: they answer it while it runs. */
const answered = (entry: Entry): boolean =>
	Object.values<Input<unknown>>(entry.program.inputs).some((declared) => declared.personOnly);

const runStages = (
	shell: Shell,
	line: Line,
	mode: Mode,
	runs: readonly {readonly stage: Stage; readonly run: string}[],
): Effect.Effect<Done> =>
	Effect.gen(function* () {
		const read: {
			readonly flags: Record<string, unknown>;
			readonly told: Record<string, unknown[]>;
		}[] = [];

		for (const stage of line.stages) {
			const got = yield* valuesOf(shell, stage);

			if (!got.ok) {
				return {status: got.status, values: []};
			}

			read.push(got);
		}

		const records = runs.map(({stage, run}, i): StageRecord => ({
			program: stage.entry.program.name,
			flags: read[i]?.flags ?? {},
			run,
			wire: stage.wire,
			ended: false,
		}));
		const [head, ...tail] = records;

		if (head === undefined) {
			return {status: 0, values: []};
		}

		const background = mode.kind === "background";
		// `call` closes every input at once: not for a program whose window tells them, nor one a
		// person answers while it runs.
		const [alone, ...others] = line.stages;
		const calling =
			!background &&
			alone !== undefined &&
			others.length === 0 &&
			viewOf(alone.entry.program) === undefined &&
			!answered(alone.entry);
		// Its stop, kept before its job is in the table (`Shell.stops`).
		const stop = yield* keepStop(shell, head.run);
		yield* note(shell, {
			type: "began",
			text: line.text,
			stages: [head, ...tail],
			background,
			owner: shell.owner,
			by: shell.by,
		});
		const n = numberOf(shell, head.run);
		const values: unknown[] = [];
		const capture = mode.kind === "capture" ? mode.output : null;
		const last = line.stages.length - 1;
		const starting = line.stages.map((stage, i): Starting => {
			const printing = printers(
				shell,
				stage.entry,
				{
					n,
					run: records[i]?.run ?? head.run,
					background,
					stages: line.stages.length,
					all: stage.all,
					typed: stage.text,
				},
				i === last ? capture : (stage.wire?.output ?? null),
				i === last ? (value) => values.push(value) : null,
			);
			return {
				entry: stage.entry,
				record: records[i] ?? head,
				told: read[i]?.told ?? {},
				fed: stage.fed,
				listeners: printing.listeners,
				flush: printing.flush,
			};
		});
		const [only] = starting;

		if (calling && only !== undefined) {
			// Heard before the run starts, so a Ctrl-C at its first instant is not lost. A stop told
			// to tsh (`stopJob`) said who asked already.
			const called = yield* Effect.gen(function* () {
				const signal = yield* PubSub.subscribe(shell.signals);
				return yield* only.entry.call(only.record.flags, {
					told: only.told,
					listeners: only.listeners,
					keeping: {id: only.record.run, storage: shell.storage},
					stopOn: Effect.raceFirst(
						PubSub.take(signal).pipe(Effect.tap(() => askStop(shell, n))),
						Deferred.await(stop.go),
					),
				});
			}).pipe(Effect.scoped, Effect.ensuring(Effect.sync(() => shell.stops.delete(head.run))));
			yield* note(shell, {
				type: "stage_ended",
				run: only.record.run,
				how: called.kind === "bad_shape" ? "failed" : jobEnd(called.ended),
			});

			if (called.kind === "bad_shape") {
				shell.print(
					"err",
					`tsh: ${only.entry.program.name}: ${called.name} does not fit: ${called.why}`,
					n,
				);
				return {status: 2, values: []};
			}

			only.flush(called.ended.kind === "ended");
			sayEnd(shell, n, line.text, [called.ended], [only.entry.program.name]);
			return {status: statusOf(called.ended), values};
		}

		const jobScope = yield* Scope.fork(shell.scope);
		const started = yield* startStages(shell, starting, !background).pipe(
			Effect.annotateLogs({job: n}),
			Scope.provide(jobScope),
		);

		if (!started.ok) {
			shell.stops.delete(head.run);
			yield* Effect.forEach(started.runs, (r) => r.stop, {concurrency: "unbounded"});
			yield* Scope.close(jobScope, Exit.void);

			// The job leaves the table now: the stages that never started never end.
			for (const record of records) {
				yield* note(shell, {type: "stage_ended", run: record.run, how: "failed"});
			}

			shell.print("err", `tsh: ${started.why}`, n);
			return {status: 1, values: []};
		}

		for (const r of started.runs) {
			shell.live.set(r.run.id, r);
		}

		const names = line.stages.map((s) => s.entry.program.name);
		const watcher = yield* watchEnds(shell, started.runs, jobScope, (ends) =>
			flushAll(starting, ends).pipe(
				Effect.andThen(
					background ? sayJobEnd(shell, n, line.text, started.runs, ends) : Effect.void,
				),
			),
		);
		yield* stopIfAsked(stop, started.runs);

		if (background) {
			shell.print("err", `[${n}] ${records.map((r) => r.run).join(" ")}`, n);
			return {status: 0, values: []};
		}

		const ends = yield* waitFor(shell, n, started.runs, watcher);
		sayEnd(shell, n, line.text, ends, names);
		return {status: statusOfJob(ends), values};
	});

/** Wait in the foreground for a job this tsh started. */
export const waitForJob = (shell: Shell, job: Job) =>
	Effect.gen(function* () {
		const runs = job.stages.flatMap((st) => {
			const r = shell.live.get(st.run);
			return r === undefined ? [] : [r];
		});
		const watcher = shell.watched.get(job.stages[0].run);

		// Its watcher left already: the job ended between the line's read and now.
		if (watcher === undefined) {
			return 0;
		}

		// In the table before the wait, as bash's `fg` moves the job first: whoever reads the table
		// (a terminal drawing a program's window) sees the job in the foreground while tsh waits.
		yield* note(shell, {type: "foreground", n: job.n});
		const ends = yield* waitFor(shell, job.n, runs, watcher);
		sayEnd(
			shell,
			job.n,
			job.text,
			ends,
			job.stages.map((s) => s.program),
		);
		return statusOfJob(ends);
	});

/**
 * Start a detached job again, under the same run ids, flags and wiring, on
 * the same storage: a program that keeps its machines finds what it left.
 * Values told on the line at its first start are not told again. `typed`:
 * the line that asked for it, the root span of the job's trace again, so the
 * runs started again write into the trace they wrote into before.
 *
 * A job keeps one writer for life (tracker 185b): one whose writer is known goes on only as that
 * writer, so a person's lane never goes on as an agent, nor an agent's as the person. A job kept
 * before jobs had a writer (`by: null`) attaches anywhere.
 *
 *   t1's tsh, as user:github:7     tsh$ attach %1 &
 *                                  tsh: this job is agent:claude for:github:7's: attach it in claude's tile
 */
export const reattach = (shell: Shell, job: Job, background: boolean, typed: string) =>
	Effect.gen(function* () {
		if (job.by !== null && job.by !== shell.by) {
			const writer = writerOf(job.by);
			const where = writer?.kind === "agent" ? `${writer.id}'s tile` : "their own tile";
			shell.print("err", `tsh: this job is ${job.by}'s: attach it in ${where}`);
			return 2;
		}

		const missing = job.stages.find((st) => !shell.list.has(st.program));

		if (missing !== undefined) {
			shell.print("err", `tsh: ${missing.program} is not on the program list any more`);
			return 1;
		}

		// Its stop, kept before the table says it runs again (`Shell.stops`).
		const stop = yield* keepStop(shell, job.stages[0].run);
		yield* note(shell, {type: "attached", n: job.n, background, owner: shell.owner});
		const starting = job.stages.map((record, i): Starting => {
			const entry = shell.list.get(record.program) as Entry;
			const before = job.stages[i - 1];
			// The job keeps no `--all`: started again, a table shows one screen, and its hint says how
			// to see the rest.
			const printing = printers(
				shell,
				entry,
				{
					n: job.n,
					run: record.run,
					background,
					stages: job.stages.length,
					all: false,
					typed: record.program,
				},
				record.wire?.output ?? null,
				null,
			);
			return {
				entry,
				record,
				told: {},
				fed: before?.wire?.input ?? null,
				listeners: printing.listeners,
				flush: printing.flush,
			};
		});
		const jobScope = yield* Scope.fork(shell.scope);
		const started = yield* startStages(shell, starting, !background).pipe(
			Effect.annotateLogs({job: job.n}),
			Scope.provide(jobScope),
		);

		if (!started.ok) {
			shell.stops.delete(job.stages[0].run);
			yield* Effect.forEach(started.runs, (r) => r.stop, {concurrency: "unbounded"});
			yield* Scope.close(jobScope, Exit.void);
			yield* note(shell, {type: "detached", n: job.n});
			shell.print("err", `tsh: ${started.why}`, job.n);
			return 1;
		}

		for (const r of started.runs) {
			shell.live.set(r.run.id, r);
		}

		// Attached in the foreground or not, the job says why it ended: one that ended on its own
		// leaves the table, and must not leave it in silence.
		const watcher = yield* watchEnds(shell, started.runs, jobScope, (ends) =>
			flushAll(starting, ends).pipe(
				Effect.andThen(sayJobEnd(shell, job.n, job.text, started.runs, ends)),
			),
		);
		yield* stopIfAsked(stop, started.runs);

		if (background) {
			shell.print("err", `[${job.n}] attached ${job.stages.map((s) => s.run).join(" ")}`, job.n);
			return 0;
		}

		return statusOfJob(yield* waitFor(shell, job.n, started.runs, watcher));
	}).pipe(
		Effect.withSpan(
			attachTitleOf(job.stages.map((s) => s.program)),
			lineSpan(job.stages[0].run, typed),
		),
	);
