// Experiment 154's fake sign-in server: OpenAI's SIWC endpoints as its docs describe them, on this
// laptop, so the box and the app are tested with no real sign-in. It is strict where the real one
// is documented to be, and says so in its answers by OAuth error name only.
//
//   GET  /.well-known/openid-configuration   the endpoints, revocation_endpoint included
//   GET  /api/accounts/authorize             checks the request; the "person" allows or denies;
//                                            302 to the loopback with code, state and, on a first
//                                            registration, the issued client_id
//   POST /api/accounts/oauth/token           authorization_code with a real S256 check (RFC 7636
//                                            4.6), each code once; refresh_token, rotating, a
//                                            spent one answered refresh_token_reused
//   POST /revoke                             RFC 7009: the refresh token's whole family
//   GET  /v1/models, POST /v1/responses      the pass as a bearer; store false and stream true
//   GET  /admin/issued                       every secret it made or saw: the leak search's list
//
// Node at the edge, said here: node:http for the server. Effect has an HTTP server, but a fake
// that answers by hand is shorter on the raw one, and nothing here is fabrika code.
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {challengeOf} from "./pkce.ts";
import {SIWC} from "./wire.ts";

const hex = (n: number) => {
	const b = crypto.getRandomValues(new Uint8Array(n));
	return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

interface Code {
	readonly client: string;
	readonly challenge: string;
	readonly redirect: string;
	readonly scope: string;
	readonly family: string;
	readonly exp: number;
	used: boolean;
}
interface Refresh {
	readonly client: string;
	readonly family: string;
	used: boolean;
}

export interface FakeOptions {
	/** The pass's life in seconds. OpenAI's is 3600. */
	readonly expiresIn: number;
	/** The scopes it grants. OpenAI's, unless a test drops the plan scope. */
	readonly scope?: string;
}

export const startFake = async (o: FakeOptions) => {
	const clients = new Set<string>();
	const codes = new Map<string, Code>();
	const refresh = new Map<string, Refresh>();
	const access = new Map<string, {readonly family: string; readonly exp: number}>();
	const revoked = new Set<string>();
	const seen = {verifiers: [] as string[], authorize: [] as Record<string, string>[]};
	const count = {trades: 0, refreshes: 0, revokes: 0, responses: 0, refused: [] as string[]};
	let decisions: ("allow" | "deny")[] = [];
	let scope = o.scope ?? SIWC.scope;

	const json = (res: ServerResponse, status: number, body: unknown) => {
		res.writeHead(status, {"content-type": "application/json"});
		res.end(JSON.stringify(body));
	};
	const oauthError = (res: ServerResponse, error: string, status = 400) => {
		count.refused.push(error);
		json(res, status, {error});
	};
	const body = (req: IncomingMessage) =>
		new Promise<string>((resolve) => {
			let s = "";
			req.on("data", (d: Buffer) => {
				s += d.toString();
			});
			req.on("end", () => resolve(s));
		});
	const familyRevoked = (family: string) => revoked.has(family);

	const authorize = (url: URL, res: ServerResponse) => {
		const p = Object.fromEntries(url.searchParams);
		seen.authorize.push(p);
		const redirect = p.redirect_uri ?? "";
		const bad = !/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/.test(redirect)
			? "redirect_uri"
			: p.response_type !== "code"
				? "response_type"
				: p.code_challenge_method !== "S256" || !p.code_challenge
					? "code_challenge"
					: !p.state || !p.nonce
						? "state"
						: !/^urn:uuid:[0-9a-f-]{36}$/.test(p.ext_agent_host_id ?? "")
							? "ext_agent_host_id"
							: !(p.scope ?? "").split(" ").includes(SIWC.planScope)
								? "scope"
								: p.client_id !== SIWC.dynamicClient && !clients.has(p.client_id ?? "")
									? "client_id"
									: null;
		if (bad !== null) return oauthError(res, `invalid_request:${bad}`);
		const back = new URL(redirect);
		back.searchParams.set("state", p.state ?? "");
		if ((decisions.shift() ?? "allow") === "deny") {
			back.searchParams.set("error", "access_denied");
		} else {
			const fresh = p.client_id === SIWC.dynamicClient;
			const client = fresh ? `app_${hex(8)}` : (p.client_id ?? "");
			clients.add(client);
			const code = `fake_code_${hex(16)}`;
			codes.set(code, {
				client,
				challenge: p.code_challenge ?? "",
				redirect,
				// What was asked for, of what this fake grants: a request without offline_access gets none.
				scope: scope
					.split(" ")
					.filter((x) => (p.scope ?? "").split(" ").includes(x))
					.join(" "),
				family: hex(8),
				exp: Date.now() + 60_000,
				used: false,
			});
			back.searchParams.set("code", code);
			// OpenAI: "On reauthorization, the callback may omit client_id".
			if (fresh) back.searchParams.set("client_id", client);
		}
		res.writeHead(302, {location: back.toString()});
		res.end();
	};

	const issue = (client: string, family: string, granted: string) => {
		const at = `fake_at_${hex(24)}`;
		access.set(at, {family, exp: Date.now() + o.expiresIn * 1000});
		// OpenAI's docs: the refresh token comes with offline_access. Without it, this fake gives none.
		const renewal = granted.split(" ").includes("offline_access");
		const rt = `fake_rt_${hex(24)}`;
		if (renewal) refresh.set(rt, {client, family, used: false});
		return {
			access_token: at,
			...(renewal ? {refresh_token: rt} : {}),
			id_token: `fake_id_${hex(16)}`,
			token_type: "Bearer",
			expires_in: o.expiresIn,
			scope: granted,
		};
	};

	const token = async (req: IncomingMessage, res: ServerResponse) => {
		const f = new URLSearchParams(await body(req));
		if (f.get("resource") !== SIWC.resource) return oauthError(res, "invalid_target");
		if (f.get("grant_type") === "authorization_code") {
			const verifier = f.get("code_verifier") ?? "";
			seen.verifiers.push(verifier);
			const c = codes.get(f.get("code") ?? "");
			if (c === undefined || c.exp < Date.now()) return oauthError(res, "invalid_grant");
			if (c.used) {
				// RFC 6749 4.1.2: a code used twice, and what it gave is revoked too.
				revoked.add(c.family);
				return oauthError(res, "invalid_grant");
			}
			c.used = true;
			if (f.get("client_id") !== c.client) return oauthError(res, "invalid_client", 401);
			if (f.get("redirect_uri") !== c.redirect) return oauthError(res, "invalid_grant");
			if ((await challengeOf(verifier)) !== c.challenge) return oauthError(res, "invalid_grant");
			count.trades++;
			return json(res, 200, issue(c.client, c.family, c.scope));
		}
		if (f.get("grant_type") === "refresh_token") {
			const r = refresh.get(f.get("refresh_token") ?? "");
			if (r === undefined || familyRevoked(r.family)) return oauthError(res, "invalid_grant");
			if (f.get("client_id") !== r.client) return oauthError(res, "invalid_client", 401);
			if (r.used) {
				revoked.add(r.family);
				return oauthError(res, "refresh_token_reused");
			}
			r.used = true;
			count.refreshes++;
			return json(res, 200, issue(r.client, r.family, scope));
		}
		return oauthError(res, "unsupported_grant_type");
	};

	const revoke = async (req: IncomingMessage, res: ServerResponse) => {
		const f = new URLSearchParams(await body(req));
		const r = refresh.get(f.get("token") ?? "");
		if (r !== undefined && r.client === f.get("client_id")) {
			revoked.add(r.family);
			count.revokes++;
		}
		// RFC 7009 2.2: 200 for an unknown token too.
		res.writeHead(200);
		res.end();
	};

	const bearer = (req: IncomingMessage) => {
		const at = (req.headers.authorization ?? "").replace(/^Bearer /, "");
		const a = access.get(at);
		return a !== undefined && a.exp > Date.now() && !familyRevoked(a.family);
	};

	const responses = async (req: IncomingMessage, res: ServerResponse) => {
		const b = JSON.parse((await body(req)) || "{}") as {
			store?: unknown;
			stream?: unknown;
			input?: unknown;
		};
		if (!bearer(req)) return json(res, 401, {error: {code: "invalid_token"}});
		if (b.store !== false || b.stream !== true)
			return json(res, 400, {error: {code: "store_false_stream_true"}});
		count.responses++;
		res.writeHead(200, {"content-type": "text/event-stream"});
		const words = String(b.input ?? "")
			.split(/\s+/)
			.filter(Boolean).length;
		const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
		send({type: "response.created"});
		send({type: "response.output_text.delta", delta: "Hi "});
		send({type: "response.output_text.delta", delta: "there"});
		send({
			type: "response.completed",
			response: {usage: {input_tokens: words + 7, output_tokens: 2}},
		});
		res.end();
	};

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://fake");
		const route = `${req.method} ${url.pathname}`;
		const done = (p: Promise<void> | void) =>
			Promise.resolve(p).catch(() => {
				if (!res.headersSent) json(res, 500, {error: "server_error"});
			});
		switch (route) {
			case "GET /.well-known/openid-configuration":
				return json(res, 200, {
					authorization_endpoint: `${base}/api/accounts/authorize`,
					token_endpoint: `${base}/api/accounts/oauth/token`,
					revocation_endpoint: `${base}/revoke`,
				});
			case "GET /api/accounts/authorize":
				return authorize(url, res);
			case "POST /api/accounts/oauth/token":
				return void done(token(req, res));
			case "POST /revoke":
				return void done(revoke(req, res));
			case "GET /v1/models":
				return bearer(req) ? json(res, 200, {data: [{id: "fake-mini"}]}) : json(res, 401, {});
			case "POST /v1/responses":
				return void done(responses(req, res));
			case "GET /admin/issued":
				return json(res, 200, {
					codes: [...codes.keys()],
					access: [...access.keys()],
					refresh: [...refresh.keys()],
					clients: [...clients],
					verifiers: seen.verifiers,
				});
			default:
				return json(res, 404, {error: "not_found"});
		}
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
	const addr = server.address();
	const port = typeof addr === "object" && addr !== null ? addr.port : 0;
	const base = `http://127.0.0.1:${port}`;
	return {
		base,
		port,
		seen,
		count,
		clients,
		/** The next sign-ins' answers, in order; after them, allow. */
		decide: (d: ("allow" | "deny")[]) => {
			decisions = [...decisions, ...d];
		},
		grant: (s: string) => {
			scope = s;
		},
		/** Is this refresh token still good? Asked of the fake's own books, not over HTTP. */
		live: (rt: string) => {
			const r = refresh.get(rt);
			return r !== undefined && !r.used && !familyRevoked(r.family);
		},
		/** Would this pass still be taken by the Responses API? */
		passLive: (at: string) => {
			const a = access.get(at);
			return a !== undefined && a.exp > Date.now() && !familyRevoked(a.family);
		},
		familyOf: (rt: string) => refresh.get(rt)?.family ?? null,
		issued: () => ({
			codes: [...codes.keys()],
			access: [...access.keys()],
			refresh: [...refresh.keys()],
			verifiers: [...seen.verifiers],
		}),
		stop: () => new Promise<void>((r) => server.close(() => r())),
	};
};

export type Fake = Awaited<ReturnType<typeof startFake>>;
