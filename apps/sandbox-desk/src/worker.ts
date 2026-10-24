import {DurableObject} from "cloudflare:workers";
import {DirectoryBackup} from "@cloudflare/sandbox";
import {Effect, Option, Schema} from "effect";
import {allowedRequest, configuration, forwarded, identity} from "./access.ts";
import {initial, Saved, save} from "./saved.ts";

export {DirectoryBackupGateway} from "@cloudflare/sandbox";

interface Env {
	DESKS: DurableObjectNamespace<Desk>;
	BACKUPS: R2Bucket;
	FABRIKA_ORIGIN: string;
	FABRIKA_OWNERS: string;
	ACCESS_ISSUER: string;
	ACCESS_AUD: string;
}
const json = (value: unknown, status = 200) =>
	Response.json(value, {status, headers: {"cache-control": "private, no-store"}});
const recovery = () =>
	new Response(
		'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recover your desk</title><main><h1>Your desk needs recovery</h1><p>The last completed save is retained. Retry will restore that save and restart programs. Newer unsaved file changes may be replaced.</p><form method="post" action="/fabrika/cloud/recover"><button>Retry saved desk</button></form></main></html>',
		{
			status: 503,
			headers: {"content-type": "text/html; charset=utf-8", "cache-control": "private, no-store"},
		},
	);
const optional = <A>(work: () => Promise<A>) =>
	Effect.runPromise(Effect.option(Effect.tryPromise({try: work, catch: () => "unavailable"})));
const Runtime = Schema.Struct({
	running: Schema.Boolean,
	clients: Schema.Int,
	state: Schema.NullOr(
		Schema.Struct({counters: Schema.Array(Schema.Struct({running: Schema.Boolean}))}),
	),
});
export default {
	async fetch(request: Request, env: Env) {
		const config = Effect.runSync(Effect.option(Effect.try(() => configuration(env))));
		if (Option.isNone(config)) return json({error: "not_configured"}, 503);
		if (!allowedRequest(request, config.value.origin)) return json({error: "forbidden"}, 403);
		const token = request.headers.get("cf-access-jwt-assertion");
		if (!token) return json({error: "access_required"}, 403);
		const owner = await optional(() => identity(token, config.value));
		if (Option.isNone(owner)) return json({error: "access_required"}, 403);
		const key = owner.value.email.toLowerCase();
		if (!Object.hasOwn(config.value.owners, key)) return json({error: "not_allowed"}, 403);
		const id = config.value.owners[key];
		if (id === undefined) return json({error: "not_allowed"}, 403);
		return env.DESKS.getByName(id).fetch(forwarded(request));
	},
} satisfies ExportedHandler<Env>;

export class Desk extends DurableObject<Env> {
	private state: Saved = initial;
	private key = "";
	private queue: Promise<unknown> = Promise.resolve();
	private readonly container: Container;
	private readonly backups: DirectoryBackup;
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		if (!ctx.container) throw Error("Desk needs its own container.");
		this.container = ctx.container;
		this.backups = new DirectoryBackup(ctx.container, ctx.exports.DirectoryBackupGateway, {
			binding: "BACKUPS",
			prefix: `desks/${ctx.id}/`,
		});
		ctx.blockConcurrencyWhile(async () => {
			this.state = Schema.decodeUnknownSync(Saved)((await ctx.storage.get("state")) ?? initial);
			this.key =
				(await ctx.storage.get<string>("gateway")) ??
				Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
					byte.toString(16).padStart(2, "0"),
				).join("");
			await ctx.storage.put("gateway", this.key);
			if (this.container.running) {
				await this.container.setInactivityTimeout(60 * 60_000);
				await this.backups.intercept();
				await ctx.storage.setAlarm(Date.now() + 60_000);
			}
			if (this.state.phase === "saving" || this.state.phase === "restoring") {
				this.state = {
					...this.state,
					phase: "failed",
					failure: "Recovery was interrupted. Reopen from the last complete save.",
				};
				await ctx.storage.put("state", this.state);
			}
		});
	}
	private locked<T>(work: () => Promise<T>): Promise<T> {
		const result = this.queue.then(work);
		this.queue = result.catch(() => undefined);
		return result;
	}
	private async call(path: string, method = "POST") {
		const response = await this.container.getTcpPort(3000).fetch(`http://gateway${path}`, {
			method,
			headers: {"x-fabrika-gateway": this.key},
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) throw Error(`Container ${path} returned ${response.status}`);
		return response.json();
	}
	private async remember(next: Saved) {
		await this.ctx.storage.put("state", next);
		this.state = next;
	}
	private async open(restore = false) {
		const fresh = !this.container.running;
		if (fresh) {
			const image = this.container.images.desk;
			if (!image) throw Error("No desk image configured.");
			this.container.start({
				image,
				enableInternet: true,
				instance: {vcpu: 1, memoryMib: 2048, diskMb: 8000},
				env: {FABRIKA_GATEWAY_KEY: this.key, FABRIKA_ORIGIN: this.env.FABRIKA_ORIGIN},
			});
			await this.container.setInactivityTimeout(60 * 60_000);
			await this.backups.intercept();
			for (let n = 0; n < 150; n++) {
				if (Option.isSome(await optional(() => this.call("/__host/status", "GET")))) break;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}
		if ((fresh || restore) && this.state.saved) {
			await this.remember({...this.state, phase: "restoring", failure: null});
			await this.call("/__host/quiet");
			await this.backups.restore(this.state.saved, {signal: AbortSignal.timeout(180_000)});
		}
		await this.call("/__host/open");
		await this.remember({...this.state, phase: "ready", failure: null});
		await this.ctx.storage.setAlarm(Date.now() + 60_000);
		await this.ctx.storage.put("active", Date.now());
	}
	private async save(sleep: boolean) {
		if (!this.container.running || this.state.phase !== "ready")
			throw Error("Open the desk before saving.");
		const previous = this.state;
		await this.remember({...previous, phase: "saving", failure: null});
		this.state = await save(previous, sleep, {
			quiet: () => this.call("/__host/quiet"),
			backup: () => this.backups.backup({dir: "/desk", signal: AbortSignal.timeout(180_000)}),
			remember: (next) => this.remember(next),
			open: () => this.call("/__host/open"),
			destroy: async () => {
				await this.container.destroy();
				await this.ctx.storage.deleteAlarm();
			},
		});
	}
	async fetch(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path === "/fabrika/cloud/recover" && request.method === "POST")
			return this.locked(async () => {
				if (this.state.phase !== "failed") return json({error: "recovery_not_needed"}, 409);
				const result = await this.open(this.state.saved !== null).then(
					() => null,
					(cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
				);
				if (result !== null) {
					await this.remember({...this.state, phase: "failed", failure: result});
					return recovery();
				}
				return Response.redirect(`${this.env.FABRIKA_ORIGIN}/fabrika/`, 303);
			});
		if (path === "/fabrika/cloud/state" && request.method === "GET")
			return json({
				phase: this.state.phase,
				saved: this.state.at,
				failure: this.state.failure,
				running: this.container.running,
			});
		if (["/fabrika/cloud/save", "/fabrika/cloud/sleep"].includes(path) && request.method === "POST")
			return this.locked(async () => {
				const result = await optional(() => this.save(path.endsWith("sleep")));
				if (Option.isNone(result)) return json({error: "save_failed"}, 409);
				return json(
					{saved: this.state.at, failure: this.state.failure},
					this.state.failure ? 409 : 200,
				);
			});
		if (path.startsWith("/fabrika/cloud/") || path.endsWith("/health") || path.includes("/__host"))
			return json({error: "not_found"}, 404);
		if (!["GET", "HEAD"].includes(request.method)) return json({error: "method_not_allowed"}, 405);
		if (["saving", "restoring"].includes(this.state.phase)) return json({error: "busy"}, 503);
		if (this.state.phase === "failed")
			return path === "/fabrika/"
				? recovery()
				: json({error: "restore_failed", why: this.state.failure}, 503);
		if (!this.container.running || this.state.phase !== "ready") {
			const failure = await this.locked(() => this.open()).then(
				() => null,
				(cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
			);
			if (failure !== null) {
				await this.remember({
					...this.state,
					phase: "failed",
					failure,
				});
				return path === "/fabrika/"
					? recovery()
					: json({error: "desk_unavailable", why: failure}, 503);
			}
		}
		await this.ctx.storage.put("active", Date.now());
		const headers = new Headers(request.headers);
		headers.set("x-fabrika-gateway", this.key);
		const target = new URL(request.url);
		target.protocol = "http:";
		return this.container
			.getTcpPort(3000)
			.fetch(new Request(new Request(target, request), {headers}));
	}
	async alarm() {
		await this.locked(async () => {
			if (!this.container.running) return;
			await this.container.setInactivityTimeout(60 * 60_000);
			const runtime = await optional(async () =>
				Schema.decodeUnknownSync(Runtime)(await this.call("/__host/status", "GET")),
			);
			if (
				Option.isSome(runtime) &&
				(runtime.value.clients > 0 ||
					runtime.value.state?.counters.some((counter) => counter.running))
			)
				await this.ctx.storage.put("active", Date.now());
			const active = (await this.ctx.storage.get<number>("active")) ?? Date.now();
			if (
				Option.isSome(runtime) &&
				Date.now() - active >= 30 * 60_000 &&
				this.state.phase === "ready"
			)
				await this.save(true);
			// Failures retry with the live disk intact. No finally block destroys it.
			if (this.container.running) await this.ctx.storage.setAlarm(Date.now() + 60_000);
		});
	}
}
