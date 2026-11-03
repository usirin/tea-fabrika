import * as Duration from "effect/Duration";
// Effect's WorkflowEngine on one Durable Object's SQLite and alarm, one object per execution.
// No fiber lives between runs: every wake replays the workflow from the top, and the journal
// answers what already happened. Shape learned from Alchemy's DurableObjectEngine, cut down for a
// spike: no interrupt, no child workflows, no retry budget on a failed run.
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Workflow from "effect/workflow/Workflow";
import * as WorkflowEngine from "effect/workflow/WorkflowEngine";

const SCHEMA = [
	"CREATE TABLE IF NOT EXISTS wf_run (id INTEGER PRIMARY KEY CHECK (id = 1), execution TEXT, payload TEXT, result TEXT)",
	"CREATE TABLE IF NOT EXISTS wf_activity (key TEXT PRIMARY KEY, exit TEXT)",
	"CREATE TABLE IF NOT EXISTS wf_deferred (name TEXT PRIMARY KEY, exit TEXT)",
	// A clock keeps its row after it fires, or the next replay would schedule it again.
	"CREATE TABLE IF NOT EXISTS wf_clock (name TEXT PRIMARY KEY, deferred TEXT, due INTEGER, fired INTEGER DEFAULT 0)",
];

const toJson = (exit: Exit.Exit<unknown, unknown>) =>
	JSON.stringify(Exit.isSuccess(exit) ? {ok: exit.value ?? null} : {bad: String(exit.cause)});
const fromJson = (text: string): Exit.Exit<unknown, unknown> => {
	const v = JSON.parse(text) as {ok?: unknown; bad?: string};
	return "bad" in v ? Exit.die(v.bad) : Exit.succeed(v.ok);
};

export const makeAlarmEngine = (state: DurableObjectState) => {
	const sql = state.storage.sql;
	for (const s of SCHEMA) sql.exec(s);
	const one = <T extends Record<string, SqlStorageValue>>(q: string, ...args: unknown[]) =>
		sql.exec<T>(q, ...args).toArray()[0];

	let registered:
		| {
				readonly workflow: Workflow.Any;
				readonly execute: (p: object, id: string) => Effect.Effect<unknown, unknown, any>;
		  }
		| undefined;

	const earliest = () => {
		const due = one<{due: number | null}>(
			"SELECT MIN(due) AS due FROM wf_clock WHERE fired = 0",
		)?.due;
		return due ?? null;
	};
	/** The one alarm is whatever is due first. A new run goes first of all. */
	const arm = (at: number) => {
		state.storage.setAlarm(at);
	};

	const run: Effect.Effect<void> = Effect.suspend(() => {
		const row = one<{execution: string; payload: string; result: string | null}>(
			"SELECT * FROM wf_run",
		);
		if (row === undefined || row.result !== null || registered === undefined) return Effect.void;
		const instance = WorkflowEngine.WorkflowInstance.initial(registered.workflow, row.execution);
		return registered.execute(JSON.parse(row.payload), row.execution).pipe(
			Workflow.intoResult,
			Effect.provideService(WorkflowEngine.WorkflowInstance, instance),
			Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
			Effect.tap((result) =>
				Effect.sync(() => {
					if (result._tag === "Complete") {
						sql.exec("UPDATE wf_run SET result = ?", toJson(result.exit));
					}
				}),
			),
			Effect.asVoid,
		) as Effect.Effect<void>;
	});

	const engine: WorkflowEngine.WorkflowEngine["Service"] = WorkflowEngine.makeUnsafe({
		register: (workflow, execute) =>
			Effect.sync(() => {
				registered = {workflow, execute};
			}),
		// Write first, then wake: a crash between the two loses nothing, the alarm is already set.
		execute: ((_workflow: Workflow.Any, options: {executionId: string; payload: object}) =>
			Effect.sync(() => {
				sql.exec(
					"INSERT OR IGNORE INTO wf_run (id, execution, payload) VALUES (1, ?, ?)",
					options.executionId,
					JSON.stringify(options.payload),
				);
				arm(Date.now());
				return undefined;
			})) as never,
		poll: () =>
			Effect.sync(() => {
				const row = one<{result: string | null}>("SELECT result FROM wf_run");
				if (row === undefined) return Option.none();
				return Option.some(
					row.result === null
						? new Workflow.Suspended({})
						: new Workflow.Complete({exit: fromJson(row.result)}),
				);
			}),
		interrupt: () => Effect.void,
		interruptUnsafe: () => Effect.void,
		resume: () => Effect.sync(() => arm(Date.now())),
		activityExecute: (activity, attempt) =>
			Effect.gen(function* () {
				const key = `${activity.name}/${attempt}`;
				const stored = one<{exit: string}>("SELECT exit FROM wf_activity WHERE key = ?", key);
				if (stored !== undefined) return new Workflow.Complete({exit: fromJson(stored.exit)});
				const parent = yield* WorkflowEngine.WorkflowInstance;
				const instance = WorkflowEngine.WorkflowInstance.initial(
					parent.workflow,
					parent.executionId,
				);
				const result = yield* activity.executeEncoded.pipe(
					Workflow.intoResult,
					Effect.provideService(WorkflowEngine.WorkflowInstance, instance),
				);
				if (result._tag === "Complete") {
					sql.exec(
						"INSERT OR REPLACE INTO wf_activity (key, exit) VALUES (?, ?)",
						key,
						toJson(result.exit),
					);
				}
				return result;
			}) as never,
		deferredResult: (deferred) =>
			Effect.sync(() => {
				const stored = one<{exit: string}>(
					"SELECT exit FROM wf_deferred WHERE name = ?",
					deferred.name,
				);
				return stored === undefined ? Option.none() : Option.some(fromJson(stored.exit));
			}),
		deferredDone: (options) =>
			Effect.sync(() => {
				sql.exec(
					"INSERT OR IGNORE INTO wf_deferred (name, exit) VALUES (?, ?)",
					options.deferredName,
					toJson(options.exit),
				);
				arm(Date.now());
			}),
		scheduleClock: (_workflow, options) =>
			Effect.sync(() => {
				sql.exec(
					"INSERT OR IGNORE INTO wf_clock (name, deferred, due) VALUES (?, ?, ?)",
					options.clock.name,
					options.clock.deferred.name,
					Date.now() + Duration.toMillis(options.clock.duration),
				);
				const due = earliest();
				if (due !== null) arm(due);
			}),
	});

	return {
		engine,
		/** The object's alarm method: settle the clocks that are due, then replay once. */
		alarm: Effect.suspend(() => {
			const now = Date.now();
			const due = sql
				.exec<{name: string; deferred: string}>(
					"SELECT name, deferred FROM wf_clock WHERE due <= ? AND fired = 0",
					now,
				)
				.toArray();
			for (const c of due) {
				sql.exec(
					"INSERT OR IGNORE INTO wf_deferred (name, exit) VALUES (?, ?)",
					c.deferred,
					toJson(Exit.void),
				);
				sql.exec("UPDATE wf_clock SET fired = 1 WHERE name = ?", c.name);
			}
			return run.pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						const next = earliest();
						if (next !== null) arm(next);
					}),
				),
			);
		}),
	};
};
