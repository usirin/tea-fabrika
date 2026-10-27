// Experiment 157's fake OpenAI: the two things a ChatGPT login talks to. Nothing here talks to
// OpenAI.
//
//   POST .../responses   the model, as Codex calls it with a ChatGPT login: the access token as a
//                        bearer and a `chatgpt-account-id` header; a stream of events (SSE). The
//                        first call of a turn asks for one tool call; the call that carries its
//                        output gets a text answer that quotes it.
//   POST /oauth/token    the refresh, as Codex sends it (JSON, `grant_type: "refresh_token"`): a new
//                        access token, a new refresh token and a new id token. A refresh token works
//                        once; a second use kills its whole family, as OAuth's rotation rule says
//                        (RFC 9700 section 4.14.2).
//
// The tokens are shaped like the real ones: the access and id tokens are JWTs whose signature part
// is `fake-access-<hex>` or `fake-id-<hex>`; nothing checks a signature. `login` makes the
// `auth.json` that `codex login` writes with file storage, for the person's app to send once.
//
// Node at the edge: node:http. A fake that answers by hand is shorter on the raw server.
import {randomBytes} from "node:crypto";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";

/** `~/.codex/auth.json` after `codex login` with `cli_auth_credentials_store = "file"`. */
export interface AuthJson {
	readonly OPENAI_API_KEY: null;
	readonly auth_mode: "chatgpt";
	readonly tokens: {
		readonly id_token: string;
		readonly access_token: string;
		readonly refresh_token: string;
		readonly account_id: string;
	};
	readonly last_refresh: string;
}

/** One model call, as the fake saw it. */
export interface Call {
	/** Whose access token it carried; null when none of ours, or a dead one. */
	readonly who: string | null;
	readonly why: "ok" | "no_bearer" | "unknown" | "expired" | "revoked";
	/** The run named in the prompt (`[[run:<id>]]`), or null. */
	readonly run: string | null;
	readonly answer: "tool" | "text" | "refused";
	/** The `chatgpt-account-id` header matched the token's account. */
	readonly account: boolean;
	/** What the tool printed, as the box sent it back, when this call carried it. */
	readonly toolOutput: string | null;
	/** Which of `who`'s access tokens it was: 1 for the sign-in, then one more per refresh. */
	readonly gen: number | null;
	readonly path: string;
	readonly at: number;
}

/** One refresh, as the fake saw it. */
export interface Refresh {
	readonly who: string | null;
	readonly what: "ok" | "reused" | "refused";
	/** The generation the refresh token belonged to. */
	readonly gen: number | null;
	readonly at: number;
}

interface Token {
	readonly who: string;
	readonly family: string;
	readonly until: number;
	readonly gen: number;
}

export interface FakeOpenAI {
	readonly url: string;
	readonly calls: readonly Call[];
	readonly refreshes: readonly Refresh[];
	/** Every secret it made, each by a part that shows wherever the token does: the leak list. */
	readonly secrets: () => readonly string[];
	/** The same, for one person. */
	readonly secretsOf: (who: string) => readonly string[];
	/** A fresh sign-in for `who`, as `codex login` saves it. The access token lives `lifeMs`. */
	readonly login: (who: string, lifeMs: number) => AuthJson;
	/** Which generation a token is, access or refresh, or null when it is not one of ours. */
	readonly genOf: (token: string) => number | null;
	/** The family a refresh token is in is dead: the person must sign in again. */
	readonly deadFor: (who: string) => boolean;
	/** Called after each refresh the fake answered, with what it was. */
	readonly onRefresh: (f: (r: Refresh) => void) => void;
	/** Change how it answers from now on. */
	readonly tune: (o: FakeOptions) => void;
	readonly close: () => Promise<void>;
}

export interface FakeOptions {
	/** How long to wait before each model answer starts: a model's thinking, so calls overlap. */
	readonly thinkMs?: number;
	/** How long a refreshed access token lives. */
	readonly lifeMs?: number;
}

const hex = (n: number) => randomBytes(n).toString("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A JWT with a fake signature: `header.payload.<sig>`. */
const jwt = (payload: Record<string, unknown>, sig: string) =>
	`${b64({alg: "RS256", typ: "JWT"})}.${b64(payload)}.${sig}`;
const sigOf = (token: string) => token.split(".")[2] ?? token;

const bodyOf = (req: IncomingMessage) =>
	new Promise<string>((resolve) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
	});

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, {"content-type": "application/json"});
	res.end(JSON.stringify(body));
};

/** The one tool call: code mode's `exec`, which runs `exec_command` in the box's copy. */
export const TOOL_JS = [
	"const r = await tools.exec_command({",
	`  cmd: "node -e \\"import('./bytes.js').then((m) => console.log('formatBytes(2048) =', m.formatBytes(2048)))\\"",`,
	"  login: false,",
	"});",
	"text(r);",
].join("\n");

/** What the tool prints in the fixture's copy: its `formatBytes` does nothing yet. */
export const TOOL_PRINTS = "formatBytes(2048) = null";

type Item = {
	readonly type?: string;
	readonly output?: unknown;
	readonly tools?: readonly {readonly name?: string; readonly tools?: readonly {name?: string}[]}[];
};

const textOf = (output: unknown): string =>
	typeof output === "string"
		? output
		: Array.isArray(output)
			? output
					.map((o) => (typeof o === "object" && o !== null && "text" in o ? String(o.text) : ""))
					.join("")
			: JSON.stringify(output ?? "");

/** Which tool Codex offered: code mode's `exec` (custom), or a plain `exec_command` function. */
const toolOf = (input: readonly Item[], tools: readonly {name?: string}[]) => {
	const nested = input
		.filter((i) => i.type === "additional_tools")
		.flatMap((i) => i.tools ?? [])
		.flatMap((ns) => ns.tools ?? [ns]);
	const names = [...nested, ...tools].map((t) => t.name);
	return names.includes("exec") ? ("exec" as const) : ("exec_command" as const);
};

export const startFakeOpenAI = (start: FakeOptions = {}): Promise<FakeOpenAI> => {
	const calls: Call[] = [];
	const refreshes: Refresh[] = [];
	const listeners: ((r: Refresh) => void)[] = [];
	/** By the access token's signature part. */
	const access = new Map<string, Token>();
	const refresh = new Map<string, Token & {used: boolean}>();
	/** Id token signature to its person. */
	const ids = new Map<string, string>();
	const dead = new Set<string>();
	const accounts = new Map<string, string>();
	const gens = new Map<string, number>();
	const families = new Map<string, string>();
	let o: FakeOptions = start;
	let n = 0;

	const mint = (who: string, family: string, life: number) => {
		const account = accounts.get(who) ?? "";
		const until = Date.now() + life;
		const gen = (gens.get(who) ?? 0) + 1;
		gens.set(who, gen);
		const auth = {
			chatgpt_plan_type: "plus",
			chatgpt_user_id: `user-${who}`,
			chatgpt_account_id: account,
		};
		const exp = Math.floor(until / 1000);
		const aSig = `fake-access-${hex(20)}`;
		const iSig = `fake-id-${hex(12)}`;
		const r = `fake-refresh-${hex(20)}`;
		const accessToken = jwt({exp, "https://api.openai.com/auth": auth, scp: ["openid"]}, aSig);
		const idToken = jwt(
			{exp, email: `${who}@people.test`, "https://api.openai.com/auth": auth},
			iSig,
		);
		access.set(aSig, {who, family, until, gen});
		refresh.set(r, {who, family, until: Number.POSITIVE_INFINITY, gen, used: false});
		ids.set(iSig, who);
		return {id_token: idToken, access_token: accessToken, refresh_token: r, account_id: account};
	};

	const responses = async (path: string, req: IncomingMessage, res: ServerResponse) => {
		const raw = await bodyOf(req);
		const auth = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
		const token = auth === undefined ? undefined : access.get(sigOf(auth));
		const why: Call["why"] =
			auth === undefined
				? "no_bearer"
				: token === undefined
					? "unknown"
					: dead.has(token.family)
						? "revoked"
						: token.until < Date.now()
							? "expired"
							: "ok";
		const run = /\[\[run:([a-z0-9-]+)\]\]/.exec(raw)?.[1] ?? null;
		const account =
			token !== undefined && req.headers["chatgpt-account-id"] === accounts.get(token.who);
		const gen = token?.gen ?? null;
		const at = Date.now();
		if (why !== "ok") {
			calls.push({
				who: null,
				why,
				run,
				answer: "refused",
				account,
				toolOutput: null,
				gen,
				path,
				at,
			});
			return json(res, 401, {
				error: {code: why === "expired" ? "token_expired" : "invalid_token", message: why},
			});
		}
		let body: {input?: Item[]; tools?: {name?: string}[]} = {};
		try {
			body = JSON.parse(raw);
		} catch {
			return json(res, 400, {error: {code: "bad_json"}});
		}
		const input = body.input ?? [];
		const outputs = input.filter(
			(i) => i.type === "custom_tool_call_output" || i.type === "function_call_output",
		);
		const toolOutput = outputs.length === 0 ? null : textOf(outputs.at(-1)?.output);
		const answer = toolOutput === null ? "tool" : "text";
		calls.push({who: token?.who ?? null, why, run, answer, account, toolOutput, gen, path, at});
		if (o.thinkMs !== undefined) await sleep(o.thinkMs);
		const id = `resp_${++n}`;
		res.writeHead(200, {"content-type": "text/event-stream", "x-request-id": `req_${n}`});
		const send = (e: Record<string, unknown>) =>
			res.write(`event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`);
		send({type: "response.created", response: {id, status: "in_progress"}});
		if (answer === "tool") {
			const tool = toolOf(input, body.tools ?? []);
			const item =
				tool === "exec"
					? {
							type: "custom_tool_call",
							id: `ctc_${n}`,
							call_id: `call_${n}`,
							name: "exec",
							input: TOOL_JS,
						}
					: {
							type: "function_call",
							id: `fc_${n}`,
							call_id: `call_${n}`,
							name: "exec_command",
							arguments: JSON.stringify({cmd: TOOL_JS.split('"')[1] ?? "", login: false}),
						};
			send({
				type: "response.output_item.added",
				output_index: 0,
				item: {...item, status: "in_progress"},
			});
			send({
				type: "response.output_item.done",
				output_index: 0,
				item: {...item, status: "completed"},
			});
		} else {
			const text = `The command printed: ${toolOutput?.includes(TOOL_PRINTS) ? TOOL_PRINTS : "something else"}`;
			const item = {type: "message", role: "assistant", id: `msg_${n}`};
			send({
				type: "response.output_item.added",
				output_index: 0,
				item: {...item, content: [], status: "in_progress"},
			});
			send({
				type: "response.output_text.delta",
				output_index: 0,
				item_id: item.id,
				content_index: 0,
				delta: text,
			});
			send({
				type: "response.output_item.done",
				output_index: 0,
				item: {
					...item,
					status: "completed",
					content: [{type: "output_text", text, annotations: []}],
				},
			});
		}
		send({
			type: "response.completed",
			response: {
				id,
				status: "completed",
				usage: {
					input_tokens: 100,
					input_tokens_details: {cached_tokens: 0},
					output_tokens: 10,
					output_tokens_details: {reasoning_tokens: 0},
					total_tokens: 110,
				},
			},
		});
		res.end();
	};

	const answered = (r: Refresh) => {
		refreshes.push(r);
		for (const f of listeners) f(r);
	};

	const token = async (req: IncomingMessage, res: ServerResponse) => {
		const raw = await bodyOf(req);
		let body: {grant_type?: string; refresh_token?: string} = {};
		try {
			body = JSON.parse(raw);
		} catch {
			body = Object.fromEntries(new URLSearchParams(raw));
		}
		const old = body.refresh_token === undefined ? undefined : refresh.get(body.refresh_token);
		const at = Date.now();
		if (body.grant_type !== "refresh_token" || old === undefined || dead.has(old.family)) {
			json(res, 401, {
				error: {code: "refresh_token_invalidated", message: "Sign in again."},
			});
			return answered({who: old?.who ?? null, what: "refused", gen: old?.gen ?? null, at});
		}
		if (old.used) {
			// A second use: someone holds a copy. The whole family dies, the person signs in again.
			dead.add(old.family);
			json(res, 401, {
				error: {code: "refresh_token_reused", message: "This refresh token was already used."},
			});
			return answered({who: old.who, what: "reused", gen: old.gen, at});
		}
		old.used = true;
		const life = o.lifeMs ?? 60_000;
		const next = mint(old.who, old.family, life);
		json(res, 200, {
			id_token: next.id_token,
			access_token: next.access_token,
			refresh_token: next.refresh_token,
			token_type: "Bearer",
			expires_in: Math.round(life / 1000),
		});
		answered({who: old.who, what: "ok", gen: old.gen, at});
	};

	const server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://fake").pathname;
		if (req.method === "POST" && path.endsWith("/responses")) return void responses(path, req, res);
		if (req.method === "POST" && path === "/oauth/token") return void token(req, res);
		void bodyOf(req).then(() => json(res, 404, {error: {code: "not_found", path}}));
	});

	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => {
			const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			resolve({
				url,
				calls,
				refreshes,
				secrets: () => [...access.keys(), ...refresh.keys(), ...ids.keys()],
				secretsOf: (who) => [
					...[...access].flatMap(([k, t]) => (t.who === who ? [k] : [])),
					...[...refresh].flatMap(([k, t]) => (t.who === who ? [k] : [])),
					...[...ids].flatMap(([k, w]) => (w === who ? [k] : [])),
				],
				login: (who, lifeMs) => {
					if (!accounts.has(who)) accounts.set(who, `acct-${hex(6)}`);
					const family = `fam-${hex(6)}`;
					families.set(who, family);
					return {
						OPENAI_API_KEY: null,
						auth_mode: "chatgpt",
						tokens: mint(who, family, lifeMs),
						last_refresh: new Date().toISOString(),
					};
				},
				genOf: (t) => access.get(sigOf(t))?.gen ?? refresh.get(t)?.gen ?? null,
				deadFor: (who) => dead.has(families.get(who) ?? ""),
				onRefresh: (f) => {
					listeners.push(f);
				},
				tune: (next) => {
					o = {...o, ...next};
				},
				close: () =>
					new Promise((r) => {
						server.closeAllConnections();
						server.close(() => r());
					}),
			});
		}),
	);
};
