// Way (c)'s person's app: it signs in itself, on the person's own machine, and keeps the session
// there. Boxes ask it for a pass; it sends each one the current access token, sealed to that box's
// key (./seal.ts), and never a refresh token. It refreshes alone, one at a time, as OpenAI's
// "Accounts and sessions" page asks ("serialize refreshes for the same session").
//
//   pass_wanted {box, turn, key}   sign in if there is no session yet (the person clicks Allow once),
//                                  refresh if the pass is near its end, then send {pass, sealed}
//   revoke()                       RFC 7009 on the refresh token: every pass it lent dies with it
//
// The session sits in this process's memory here: the stand-in for the person's keychain. A real
// app would keep it in the OS keychain, mode 0600 at the least, as the sign-in page asks.
//
// Two parts: `makeSession`, the person's session on fetch and node:http alone, and `runLender`,
// which reads the person's inbox on the ledger and answers each box.
//
// Node at the edge, said here: node:http for the catcher, as in ./app.ts.
import {createServer} from "node:http";
import {Ledger, streams} from "@kampus/fabrika-old";
import {Duration, Effect, Schema} from "effect";
import {bindLoopback, readCallback} from "./app.ts";
import {aboutOf} from "./lent-cells.ts";
import {hostId, pkce, randomValue} from "./pkce.ts";
import {seal} from "./seal.ts";
import {type Auth, boxName, personName, redirectOf, SIWC, type ToBox, ToPerson} from "./wire.ts";

export interface LenderOptions {
	readonly who: string;
	readonly auth: Auth;
	/** Opens the sign-in page: a browser on the laptop, or the fake person in a test. */
	readonly open: (url: string) => Promise<void>;
	/** Refresh when less than this is left of the pass. */
	readonly marginMs: number;
	readonly agentName: string;
	readonly say: (event: Record<string, unknown>) => void;
}

interface Session {
	readonly access: string;
	readonly refresh: string | null;
	readonly client: string;
	readonly scopes: readonly string[];
	readonly life: number;
	readonly expiresAt: number;
}

const WRITER = "user:person";

const TokenAnswer = Schema.Struct({
	access_token: Schema.String,
	refresh_token: Schema.optional(Schema.String),
	expires_in: Schema.Number,
	scope: Schema.String,
});
const tokenAnswerOf = Schema.decodeUnknownSync(TokenAnswer);

const post = async (url: string, form: Record<string, string>) => {
	const res = await fetch(url, {
		method: "POST",
		headers: {accept: "application/json", "content-type": "application/x-www-form-urlencoded"},
		body: new URLSearchParams(form),
	});
	const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `http_${res.status}`);
	return tokenAnswerOf(body);
};

const keep = (t: typeof TokenAnswer.Type, client: string): Session => ({
	access: t.access_token,
	refresh: t.refresh_token ?? null,
	client,
	scopes: t.scope.split(" ").filter(Boolean),
	life: t.expires_in * 1000,
	expiresAt: Date.now() + t.expires_in * 1000,
});

/** The person's own session: one sign-in, then refreshes, one at a time. */
export const makeSession = (o: LenderOptions) => {
	// Stable for this app on this machine, as the sign-in page asks of ext_agent_host_id.
	const host = hostId();
	let session: Session | null = null;
	let savedClient: string | null = null;
	let lock: Promise<unknown> = Promise.resolve();
	const count = {signIns: 0, refreshes: 0, lent: 0, revoked: 0};

	/** The person's one sign-in: a loopback catcher here, the page in their browser. */
	const signIn = async (): Promise<Session> => {
		const {verifier, challenge} = await pkce();
		const state = randomValue(32);
		let answer: (a: {code: string; client: string | null} | Error) => void = () => {};
		const got = new Promise<{code: string; client: string | null} | Error>((r) => {
			answer = r;
		});
		let port = 0;
		const server = createServer((req, res) => {
			const read = readCallback(new URL(req.url ?? "/", redirectOf(port)), port, state);
			if ("refused" in read || read.ok.kind !== "code") {
				res.writeHead(400).end("fabrika: this sign-in was not asked for here.");
				if (!("refused" in read)) answer(new Error("denied"));
				return;
			}
			res.writeHead(200).end("fabrika: signed in. You can close this window.");
			answer({code: read.ok.code, client: read.ok.client});
		});
		port = await bindLoopback(server, SIWC.port, o.say);
		const client = savedClient ?? SIWC.dynamicClient;
		const url = new URL(o.auth.authorize);
		url.search = new URLSearchParams({
			client_id: client,
			...(client === SIWC.dynamicClient ? {agent_name_hint: o.agentName} : {}),
			ext_agent_host_id: host,
			response_type: "code",
			redirect_uri: redirectOf(port),
			resource: SIWC.resource,
			scope: SIWC.scope,
			state,
			code_challenge: challenge,
			code_challenge_method: "S256",
			nonce: randomValue(32),
		}).toString();
		o.say({ev: "opened", for: "lender"});
		await o.open(url.toString());
		const a = await got;
		server.close();
		server.closeAllConnections();
		if (a instanceof Error) throw a;
		const issued = client === SIWC.dynamicClient ? a.client : client;
		if (issued === null) throw new Error("no issued client id came back");
		savedClient = issued;
		const t = await post(o.auth.token, {
			grant_type: "authorization_code",
			client_id: issued,
			code: a.code,
			code_verifier: verifier,
			redirect_uri: redirectOf(port),
			resource: SIWC.resource,
		});
		count.signIns++;
		return keep(t, issued);
	};

	/** The current pass, signed in or refreshed first if need be. One caller at a time. */
	const passNow = (): Promise<Session> => {
		const next = lock.then(async () => {
			const s = session;
			const left = s === null ? 0 : s.expiresAt - Date.now();
			if (s !== null && left > Math.min(o.marginMs, s.life / 2) + 100) return s;
			if (s !== null && s.refresh !== null) {
				const t = await post(o.auth.token, {
					grant_type: "refresh_token",
					client_id: s.client,
					refresh_token: s.refresh,
					resource: SIWC.resource,
				});
				count.refreshes++;
				session = keep(t, s.client);
			} else {
				session = await signIn();
			}
			return session;
		});
		lock = next.catch(() => undefined);
		return next;
	};

	return {
		count,
		passNow,
		/** The renewal key, for the test only: it checks the key is here and nowhere else. */
		refreshNow: () => session?.refresh ?? null,
		/** RFC 7009 on the refresh token; the session is gone either way. */
		revoke: async () => {
			const s = session;
			session = null;
			if (s === null || s.refresh === null || o.auth.revoke === null) return false;
			const res = await fetch(o.auth.revoke, {
				method: "POST",
				headers: {"content-type": "application/x-www-form-urlencoded"},
				body: new URLSearchParams({
					token: s.refresh,
					token_type_hint: "refresh_token",
					client_id: s.client,
				}),
			});
			if (res.ok) count.revoked++;
			return res.ok;
		},
	};
};

type Lending = ReturnType<typeof makeSession>;

/** One box's answer: the pass sealed to its key, or why not. Never the refresh token. */
const answerFor = async (
	session: Lending,
	lent: string[],
	box: string,
	turn: number,
	key: string,
): Promise<ToBox> => {
	try {
		const s = await session.passNow();
		if (!s.scopes.includes(SIWC.planScope)) return {kind: "no_pass", turn, why: "no_scope"};
		const sealed = await seal(key, s.access, aboutOf(box, turn));
		lent.push(s.access);
		session.count.lent++;
		const expires_in = Math.floor((s.expiresAt - Date.now()) / 1000);
		return {kind: "pass", turn, sealed, expires_in, scopes: s.scopes};
	} catch (e) {
		return {kind: "no_pass", turn, why: String(e).slice(0, 80)};
	}
};

const toPersonOf = Schema.decodeUnknownExit(Schema.fromJsonString(ToPerson));

/** The person's app for way (c), until its scope closes. */
export const runLender = (o: LenderOptions) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* ledger.register(personName(o.who), WRITER);
		const session = makeSession(o);
		const lentPasses: string[] = [];
		const lend = (box: string, turn: number, key: string) =>
			Effect.promise(() => answerFor(session, lentPasses, box, turn, key)).pipe(
				Effect.tap(() => Effect.sync(() => o.say({ev: "lend", box, turn}))),
				Effect.flatMap((row) =>
					ledger.send(streams(boxName(box)).inbox, `${box}/${row.kind}/${turn}`, {
						kind: row.kind,
						writer: WRITER,
						data: row,
					}),
				),
				Effect.ignore,
			);
		let rev = 0;
		const inbox = streams(personName(o.who)).inbox;
		yield* Effect.forkScoped(
			Effect.gen(function* () {
				for (;;) {
					const rows = yield* ledger
						.readStream(inbox, rev, 100)
						.pipe(Effect.orElseSucceed(() => []));
					for (const r of rows) {
						rev = r.rev;
						const read = toPersonOf(r.data);
						if (read._tag !== "Success") continue;
						const w = read.value;
						// Forked: one slow sign-in does not hold up the next box's row.
						if (w.kind === "pass_wanted") yield* Effect.forkScoped(lend(w.box, w.turn, w.key));
						if (w.kind === "sign_in_ended") o.say({ev: "box_ended", box: w.box, why: w.why});
					}
					yield* Effect.sleep(Duration.millis(100));
				}
			}),
		);
		return {
			count: session.count,
			/** Every pass this app lent: the test checks where they went. Kept in memory only. */
			lentPasses,
			refreshNow: session.refreshNow,
			revoke: session.revoke,
		};
	});
