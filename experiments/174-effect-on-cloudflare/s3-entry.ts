// Part 3: an agent turn, shaped like Tier 5's, as an Effect Workflow on one object's alarm.
//
// draft (an activity) -> a durable clock -> a person's approval -> post (an activity)
//
// /start?clockMs=&killDraft=1   start the turn. killDraft kills the object inside the first draft.
// /approve                      the person says yes
// /stats                        what ran, how many activations
import {DurableObject} from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import * as Activity from "effect/workflow/Activity";
import * as DurableClock from "effect/workflow/DurableClock";
import * as DurableDeferred from "effect/workflow/DurableDeferred";
import * as Workflow from "effect/workflow/Workflow";
import * as WorkflowEngine from "effect/workflow/WorkflowEngine";
import {makeAlarmEngine} from "./alarm-engine.ts";

type Env = {TURN: DurableObjectNamespace};

const Approval = DurableDeferred.make("approval", {success: Schema.String});

const Turn = Workflow.make("Turn", {
	payload: {ticket: Schema.String, clockMs: Schema.Number, killDraft: Schema.Boolean},
	success: Schema.String,
	idempotencyKey: (p) => p.ticket,
});

export class TurnObject extends DurableObject<Env> {
	rt: ManagedRuntime.ManagedRuntime<WorkflowEngine.WorkflowEngine, never>;
	alarmRun: Effect.Effect<void>;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = ctx.storage.sql;
		sql.exec("CREATE TABLE IF NOT EXISTS wakes (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER)");
		sql.exec("CREATE TABLE IF NOT EXISTS ran (what TEXT, at INTEGER)");
		sql.exec("INSERT INTO wakes (at) VALUES (?)", Date.now());
		const made = makeAlarmEngine(ctx);
		this.alarmRun = made.alarm;
		const log = (what: string) =>
			sql.exec("INSERT INTO ran (what, at) VALUES (?, ?)", what, Date.now());
		const times = (what: string) =>
			sql.exec("SELECT what FROM ran WHERE what = ?", what).toArray().length;
		const engine = Layer.succeed(WorkflowEngine.WorkflowEngine, made.engine);
		const handler = Turn.toLayer(({ticket, clockMs, killDraft}) =>
			Effect.gen(function* () {
				log("replay");
				const draft = yield* Activity.make({
					name: "draft",
					success: Schema.String,
					execute: Effect.suspend(() => {
						log("draft");
						if (killDraft && times("draft") === 1) {
							// The object dies mid activity, with the alarm that started this run still owed.
							// Commit first: an abort also drops writes not yet on disk, this one included.
							return Effect.promise(() => ctx.storage.sync()).pipe(
								Effect.andThen(Effect.sync(() => ctx.abort("spike: killed inside the activity"))),
								Effect.andThen(Effect.never),
							);
						}
						return Effect.succeed(`draft for ${ticket}`);
					}),
				});
				yield* DurableClock.sleep({
					name: "cool",
					duration: `${clockMs} millis`,
					inMemoryThreshold: "0 millis",
				});
				log("after clock");
				const answer = yield* DurableDeferred.await(Approval);
				log("after approval");
				const post = yield* Activity.make({
					name: "post",
					success: Schema.String,
					execute: Effect.sync(() => {
						log("post");
						return "posted";
					}),
				});
				return `${draft} / ${answer} / ${post}`;
			}),
		);
		this.rt = ManagedRuntime.make(handler.pipe(Layer.provideMerge(engine)));
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		const sql = this.ctx.storage.sql;
		if (url.pathname === "/start") {
			const payload = {
				ticket: "7",
				clockMs: Number(url.searchParams.get("clockMs") ?? "1000"),
				killDraft: url.searchParams.get("killDraft") === "1",
			};
			const id = await this.rt.runPromise(Turn.execute(payload, {discard: true}));
			return Response.json({id});
		}
		if (url.pathname === "/approve") {
			await this.rt.runPromise(
				Effect.gen(function* () {
					const row = sql.exec<{execution: string}>("SELECT execution FROM wf_run").one();
					const token = DurableDeferred.tokenFromExecutionId(Approval, {
						workflow: Turn,
						executionId: row.execution,
					});
					yield* DurableDeferred.done(Approval, {token, exit: Exit.succeed("yes")});
				}),
			);
			return new Response("ok");
		}
		if (url.pathname === "/stats") {
			const ran = sql
				.exec<{what: string}>("SELECT what FROM ran")
				.toArray()
				.map((r) => r.what);
			const result =
				sql.exec<{result: string | null}>("SELECT result FROM wf_run").toArray()[0]?.result ?? null;
			return Response.json({
				wakes: sql.exec("SELECT n FROM wakes").toArray().length,
				ran,
				result,
				alarm: await this.ctx.storage.getAlarm(),
			});
		}
		return new Response("?", {status: 404});
	}

	async alarm() {
		await this.rt.runPromise(this.alarmRun);
	}
}

export default {
	fetch(request: Request, env: Env) {
		const url = new URL(request.url);
		const name = url.searchParams.get("name") ?? "one";
		return env.TURN.get(env.TURN.idFromName(name)).fetch(request);
	},
};
