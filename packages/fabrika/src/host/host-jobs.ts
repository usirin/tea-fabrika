import {run as runMachine, type StoreFailed} from "@demlik/tea/effect";
import {Context, Effect, type Scope} from "effect";
import type {Watchable} from "../program/program.ts";
import type {Storage} from "../program/storage.ts";
import {Jobs, type JobsMsg, jobsMachine} from "./jobs.ts";

// Where a host keeps its jobs. A job is what one start on a host made: a root run and every run
// it started, like a Unix process group. A tsh line is a job; so is a lane. The host keeps them,
// as a kernel keeps process groups and as WezTerm's mux keeps every pane for the clients that
// show it (docs/direction/the-host-keeps-terminals-and-jobs.md). A shell only shows them and
// asks for changes: tsh's `jobs`, `&`, `attach %n`, `fg` and its detach are Msgs to the host's
// table (../shell/builtins.ts).
//
//   const jobs = yield* openJobs(fileStorage(home));     // the host, once, in its own scope
//   yield* start(tsh, ...).pipe(Effect.provideService(HostJobs, jobs));   // each tsh, a view on it
//
// One table per host process. Every tsh on that host (each tile's, in the app) is handed the
// same one, so each sees the same `%n`. Numbers count up and are never given twice (./jobs.ts).
//
// Two kinds of host keep jobs two ways:
//
// - A host that runs programs in its own process (tsh's launcher, the app's host process) keeps
//   the job table (./jobs.ts), one tea machine, in the storage it is handed. A host started
//   again finds every job the last one had, under the same run ids.
// - On tea-host the ledger's registry is the table already: a name with no parent leads a job,
//   and `startChild` puts a child in its parent's job, as a forked child keeps its parent's
//   process group (OTP's group leader). `leaderOf` (./leader.ts) reads it; nothing more is
//   written.
//
// A job's trace is its leader's: `traceIdOf` for a line (./jobs.ts), `traceOf(leader)` for a
// hosted name (./host.ts starts each program under it). The same key gives the same trace in any
// process, so a job that moves host, or whose host restarts, stays one trace.

/**
 * Where a host keeps its table in the storage it is handed: one run for every host that opens
 * that storage. It is where tsh kept it before the table moved to the host, so a home kept by
 * older code opens as it is. A host opens this run anew, so an older host still on the same
 * storage has its next table write fail `Stale`: two hosts never both write the table.
 */
export const TABLE = {run: "tsh", machine: "jobs", key: "table"} as const;

/** The host's table, as a client sees it: its state, its changes, and the Msgs it takes. */
export interface JobTable extends Watchable<Jobs> {
	readonly dispatch: (msg: JobsMsg) => Effect.Effect<void, unknown>;
}

/** What a host hands whatever starts programs on it. */
export interface JobsOnHost {
	readonly table: JobTable;
	/** Where the jobs' runs keep their state, each under its run id. */
	readonly storage: Storage;
	/** `false`: the table found was saved by older code. It is left as it was, and jobs started now are not kept. */
	readonly kept: boolean;
}

/** The host's jobs. Whoever runs a host opens them (`openJobs`) and hands them to tsh. */
export class HostJobs extends Context.Service<HostJobs, JobsOnHost>()("host/Jobs") {}

/**
 * Open the host's job table on `storage`, for as long as the caller's scope. Whatever ran
 * before the host started does not run now: every job it finds is detached, to be attached.
 * A table saved by older code is never opened and never written over: the host runs on with
 * a table it does not keep, as tea says a host does when a store refuses (its
 * `StoreRefusedError`), and says so through `kept`. `StoreFailed`: the table could not be loaded.
 */
export const openJobs = (storage: Storage): Effect.Effect<JobsOnHost, StoreFailed, Scope.Scope> =>
	Effect.gen(function* () {
		const home = yield* storage.open(TABLE.run, null).pipe(Effect.orDie);
		// Read first through its schema, so a refused table is known before tea loads it.
		const kept = yield* home.read(TABLE.machine, TABLE.key, Jobs).pipe(
			Effect.as(true),
			Effect.catchTag("StateRefused", () => Effect.succeed(false)),
			Effect.orDie,
		);
		const table = yield* (yield* runMachine(jobsMachine, {
			ctx: undefined,
			...(kept ? {store: home.store(TABLE.machine, TABLE.key, Jobs)} : {}),
		})).ready;
		yield* table.dispatch({type: "detached", n: null}).pipe(Effect.orDie);
		return {table, storage, kept};
	});
