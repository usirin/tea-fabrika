// Experiment 147 reuses this file from experiment 144 (pull request 99) as it was, only this
// first paragraph is new. Its own words follow.
//
// Experiment 144's Worker: the ledger's real Durable Object (packages/fabrika/src/host/
// durable-object.ts, unchanged) on Cloudflare, behind a door that wants the run's key.
//
// The key is the first segment of every path. The Worker holds only its SHA-256 (`KEY_HASH`), so
// neither Alchemy's state nor Cloudflare ever holds the key. A path without it answers 404, before
// any object is touched, so a stranger's request costs no Durable Object request.
//
//   /<key>/<ledger>/<method>, /<key>/<ledger>/tail   the real face, as it is
//   /<key>/x/ping                                    the Worker alone, no object
//   /<key>/x/now?ledger=                             the Worker's clock, and the object's if named
//   /<key>/x/where?ledger=&hint=                     the colo the object runs in
//   /<key>/x/timed?ledger=&hint=   {method, args}    one call, and whether the object was new
//   /<key>/x/batch                 {mode, calls}     calls to several objects, side by side or not
//   /<key>/x/gh                                      GitHub's GET /users/octocat/keys, from here
//
// Every answer but a WebSocket's carries `x-colo` (where the Worker ran), `x-worker-ms` (how long
// the Worker waited on the object), `x-round` (which deploy answered) and `x-code` (which build).
import face, {Ledger as RealLedger} from "../../packages/fabrika/src/host/durable-object.ts";

/** Which build this is. alchemy.run.ts writes it into the bundle, so a new one is new code. */
declare const __EXP_CODE__: string;

type Stub = {fetch(req: Request): Promise<Response>} & Record<
	string,
	((...args: unknown[]) => Promise<unknown>) | undefined
>;
type Namespace = {
	idFromName(name: string): unknown;
	get(id: unknown, options?: {locationHint: string}): Stub;
};
type Env = {LEDGER: Namespace; KEY_HASH: string; ROUND: string};

/** The calls this experiment makes on an object; the real face keeps its own list. */
const CALLS = new Set([
	"register",
	"append",
	"claim",
	"readStream",
	"readLast",
	"lease",
	"watchers",
]);

// workerd refuses random values outside a request, so the isolate's name is made on first use.
let isolateName = "";
const isolate = () => {
	isolateName ||= crypto.randomUUID().slice(0, 8);
	return isolateName;
};

/** The real object, plus three calls: whether it is new, what its clock says, where it runs. */
export class Ledger extends RealLedger {
	/** When this instance was made: a new one after every eviction, hibernation and deploy. */
	private readonly born = Date.now();
	/** Calls this instance has served. 1 on the first: the call that found the object cold. */
	private served = 0;

	async timed(method: string, args: unknown[]) {
		this.served += 1;
		const fn: unknown = CALLS.has(method) ? Reflect.get(this, method) : undefined;
		if (typeof fn !== "function") return {error: `no call ${method}`};
		const res: unknown = await Reflect.apply(fn, this, args);
		return {res, born: this.born, served: this.served, isolate: isolate(), code: __EXP_CODE__};
	}

	/** The object's clock, read the way its calls read it: `Date.now()` as a call comes in. */
	async clock() {
		return {now: Date.now()};
	}

	/** The colo, read the way where.durableobjects.live reads it: Cloudflare's trace, from here. */
	async where() {
		this.served += 1;
		const trace = await (await fetch("https://www.cloudflare.com/cdn-cgi/trace")).text();
		const colo = /^colo=(.+)$/m.exec(trace)?.[1] ?? null;
		return {colo, born: this.born, served: this.served, isolate: isolate()};
	}
}

const sha256 = async (text: string) =>
	Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
		(b) => b.toString(16).padStart(2, "0"),
	).join("");

const keyOk = async (key: string, want: string) => {
	if (key.length === 0 || want.length !== 64) return false;
	const got = new TextEncoder().encode(await sha256(key));
	const exp = new TextEncoder().encode(want);
	return crypto.subtle.timingSafeEqual(got, exp);
};

const coloOf = (req: Request): string => {
	const cf: unknown = Reflect.get(req, "cf");
	const colo: unknown = typeof cf === "object" && cf !== null ? Reflect.get(cf, "colo") : null;
	return typeof colo === "string" ? colo : "?";
};

const field = (o: unknown, key: string): unknown =>
	typeof o === "object" && o !== null ? Reflect.get(o, key) : undefined;

type Call = {ledger: string; method: string; args: unknown[]};
const callOf = (o: unknown): Call | null => {
	const ledger = field(o, "ledger");
	const method = field(o, "method");
	const args = field(o, "args");
	return typeof ledger === "string" && typeof method === "string" && Array.isArray(args)
		? {ledger, method, args}
		: null;
};

const stubOf = (env: Env, ledger: string, hint: string | null) =>
	hint
		? env.LEDGER.get(env.LEDGER.idFromName(ledger), {locationHint: hint})
		: env.LEDGER.get(env.LEDGER.idFromName(ledger));

/** One RPC call on one object, timed from the Worker. */
const one = async (env: Env, c: Call) => {
	if (!CALLS.has(c.method)) return {error: `no call ${c.method}`, ms: 0};
	const t = Date.now();
	const res = await stubOf(env, c.ledger, null)[c.method]?.(...c.args);
	return {res, ms: Date.now() - t};
};

/** GitHub's public keys of the octocat account, from the Worker: its status and rate limit. */
const github = async () => {
	const t = Date.now();
	const res = await fetch("https://api.github.com/users/octocat/keys", {
		headers: {"user-agent": "tf-exp-144", accept: "application/vnd.github+json"},
	});
	const body: unknown = await res.json().catch(() => null);
	const h = (name: string) => res.headers.get(name);
	return {
		status: res.status,
		ms: Date.now() - t,
		keys: Array.isArray(body) ? body.length : null,
		limit: h("x-ratelimit-limit"),
		remaining: h("x-ratelimit-remaining"),
		used: h("x-ratelimit-used"),
		reset: h("x-ratelimit-reset"),
		resource: h("x-ratelimit-resource"),
		retryAfter: h("retry-after"),
	};
};

const route = async (req: Request, url: URL, rest: string[], env: Env): Promise<Response> => {
	if (rest[0] !== "x") {
		const inner = new URL(url);
		inner.pathname = `/${rest.join("/")}`;
		return face.fetch(new Request(inner, req), env);
	}
	const ledger = url.searchParams.get("ledger") ?? "";
	const hint = url.searchParams.get("hint");
	switch (rest[1]) {
		case "ping":
			return Response.json({ok: true});
		case "now": {
			const before = Date.now();
			if (!ledger) return Response.json({now: before});
			const there = await stubOf(env, ledger, null).clock?.();
			return Response.json({now: before, object: field(there, "now"), after: Date.now()});
		}
		case "where":
			return Response.json(await stubOf(env, ledger, hint).where?.());
		case "timed": {
			const body: unknown = await req.json();
			const method = field(body, "method");
			const args = field(body, "args");
			if (typeof method !== "string" || !Array.isArray(args))
				return new Response("bad call", {status: 400});
			return Response.json(await stubOf(env, ledger, hint).timed?.(method, args));
		}
		case "batch": {
			const body: unknown = await req.json();
			const raw = field(body, "calls");
			const calls = Array.isArray(raw) ? raw.map(callOf) : [];
			if (calls.length === 0 || calls.some((c) => c === null))
				return new Response("bad calls", {status: 400});
			const t = Date.now();
			const each = [];
			if (field(body, "mode") === "parallel")
				each.push(...(await Promise.all(calls.map((c) => (c ? one(env, c) : null)))));
			else for (const c of calls) each.push(c ? await one(env, c) : null);
			return Response.json({each, ms: Date.now() - t});
		}
		case "gh":
			return Response.json(await github());
	}
	return new Response("not found", {status: 404});
};

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		const [, key = "", ...rest] = url.pathname.split("/");
		if (!(await keyOk(key, env.KEY_HASH))) return new Response("not found", {status: 404});
		const t = Date.now();
		let res: Response;
		try {
			res = await route(req, url, rest, env);
		} catch (e) {
			res = Response.json({error: e instanceof Error ? e.message : String(e)}, {status: 500});
		}
		if (res.status === 101) return res;
		const out = new Response(res.body, res);
		out.headers.set("x-colo", coloOf(req));
		out.headers.set("x-worker-ms", String(Date.now() - t));
		out.headers.set("x-round", env.ROUND);
		out.headers.set("x-code", __EXP_CODE__);
		return out;
	},
};
