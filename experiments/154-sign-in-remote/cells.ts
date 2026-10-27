// The sign-in machine's cells and its inbox Sub: the only code in the box that talks to the ledger
// and to the sign-in server. The machine is ./machine.ts; the pass stays in the `Vault`.
//
//   want     send {kind: "sign_in_wanted"} to the person's inbox
//   offer    PKCE pair, state, nonce, a fresh ext_agent_host_id; the URL to the person's inbox
//   trade    POST grant_type=authorization_code with the verifier (RFC 7636 section 4.5)
//   refresh  POST grant_type=refresh_token; the old refresh token is spent (it rotates). With no
//            refresh token (way b) it fails `no_renewal`, and the machine asks the person again
//   forget   close the vault, POST the refresh token to the revocation endpoint (RFC 7009), and
//            tell the person it ended
//
// HTTP is `fetch`, the web standard, which a box and a Worker have too. It is wrapped in Effect
// here and nowhere else.
import {Ledger, streams} from "@kampus/fabrika";
import {Context, Duration, Effect, Redacted, Schedule, Schema, Stream} from "effect";
import type {forget, InboxSub, offer, refresh, SignInMsg, trade, want} from "./machine.ts";
import {hostId, pkce, randomValue} from "./pkce.ts";
import {Vault} from "./vault.ts";
import {type Auth, boxName, personName, redirectOf, SIWC, ToBox, type ToPerson} from "./wire.ts";

export interface BoxSettings {
	readonly box: string;
	readonly who: string;
	readonly auth: Auth;
	/** How long the box waits for the code. */
	readonly waitMs: number;
	readonly marginMs: number;
	/** The issued client to sign in on, if the person's app saved one. `null`: register anew. */
	readonly client: string | null;
	readonly agentName: string;
	/**
	 * How the pass is renewed. `refresh`: ask for `offline_access` and refresh (way a). `ask`: no
	 * `offline_access`, so no refresh token; the person is asked again when the pass runs out (way b).
	 */
	readonly renew: "refresh" | "ask";
	/** Where the box says what happened: never a token, only lengths, counts and names. */
	readonly say: (event: Record<string, unknown>) => void;
}

export class Box extends Context.Service<Box, BoxSettings>()("exp154/Box") {}

const WRITER = "agent:box";
const unreachable = (why: string) => ({_tag: "unreachable" as const, why});

/** Send one row to the person's inbox; a name not registered yet is tried again for 10 s. */
export const tellPerson = (row: ToPerson, id: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const {who} = yield* Box;
		yield* ledger
			.send(streams(personName(who)).inbox, id, {kind: row.kind, writer: WRITER, data: row})
			.pipe(
				Effect.retry({
					while: (e) => e._tag === "UnknownName" || e._tag === "LedgerUnreachable",
					schedule: Schedule.spaced(Duration.millis(200)),
					times: 50,
				}),
			);
	});

export const wantCell = (cmd: ReturnType<typeof want>) =>
	Effect.gen(function* () {
		const {box} = yield* Box;
		yield* tellPerson({kind: "sign_in_wanted", box}, `${box}/wanted/${cmd.round}`);
		return null;
	}).pipe(Effect.mapError((e) => unreachable(String(e))));

export const offerCell = (cmd: ReturnType<typeof offer>) =>
	Effect.gen(function* () {
		const s = yield* Box;
		const vault = yield* Vault;
		const {verifier, challenge} = yield* Effect.promise(pkce);
		const state = randomValue(32);
		const redirect = redirectOf(cmd.port);
		// A later round signs in again on the client the first round was issued, as the docs say.
		const client = s.client ?? (yield* vault.held)?.client ?? SIWC.dynamicClient;
		const url = new URL(s.auth.authorize);
		url.search = new URLSearchParams({
			client_id: client,
			// OpenAI: "include it only on initial dynamic-registration requests".
			...(client === SIWC.dynamicClient ? {agent_name_hint: s.agentName} : {}),
			ext_agent_host_id: hostId(),
			response_type: "code",
			redirect_uri: redirect,
			resource: SIWC.resource,
			scope: s.renew === "refresh" ? SIWC.scope : SIWC.scopeNoRenewal,
			state,
			code_challenge: challenge,
			code_challenge_method: "S256",
			nonce: randomValue(32),
		}).toString();
		yield* vault.open({verifier: Redacted.make(verifier), redirect, client});
		yield* tellPerson(
			{kind: "sign_in_url", box: s.box, url: url.toString()},
			`${s.box}/url/${cmd.round}`,
		);
		s.say({ev: "url", port: cmd.port, round: cmd.round});
		return {state, waitMs: s.waitMs};
	}).pipe(Effect.mapError((e) => unreachable(String(e))));

const TokenAnswer = Schema.Struct({
	access_token: Schema.String,
	/** Absent when `offline_access` was not granted (way b). */
	refresh_token: Schema.optional(Schema.String),
	expires_in: Schema.Number,
	scope: Schema.String,
	id_token: Schema.optional(Schema.String),
});
const tokenAnswerOf = Schema.decodeUnknownExit(TokenAnswer);

type PostErr = {readonly _tag: "refused" | "unreachable"; readonly why: string};

/** POST a form; a 400 or 401 is `refused` with the OAuth error's name, never its body. */
const postForm = (url: string, form: Record<string, string>) =>
	Effect.tryPromise({
		try: async () => {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams(form),
			});
			const text = await res.text();
			return {status: res.status, text};
		},
		catch: (e): PostErr => ({_tag: "unreachable", why: String(e).slice(0, 120)}),
	}).pipe(
		Effect.flatMap(({status, text}) => {
			if (status >= 200 && status < 300) return Effect.succeed(text);
			let error = `http_${status}`;
			try {
				const j = JSON.parse(text) as {error?: unknown};
				if (typeof j.error === "string") error = j.error;
			} catch {
				// not JSON: the status says enough
			}
			return Effect.fail<PostErr>({
				_tag: status === 400 || status === 401 ? "refused" : "unreachable",
				why: error,
			});
		}),
	);

const refreshInMs = (expiresIn: number, marginMs: number) => {
	const life = expiresIn * 1000;
	return Math.max(0, life - Math.min(marginMs, life / 2));
};

/** Read a token answer, check the plan scope, and put the pass in the vault. */
const keep = (text: string, client: string, kind: "trade" | "refresh") =>
	Effect.gen(function* () {
		const s = yield* Box;
		const vault = yield* Vault;
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			return yield* Effect.fail({_tag: "unreachable" as const, why: "not JSON"});
		}
		const read = tokenAnswerOf(json);
		if (read._tag === "Failure")
			return yield* Effect.fail({_tag: "unreachable" as const, why: "an answer of another shape"});
		const t = read.value;
		const scopes = t.scope.trim().split(/\s+/).filter(Boolean);
		const held = {
			access: Redacted.make(t.access_token),
			refresh: t.refresh_token === undefined ? null : Redacted.make(t.refresh_token),
			client,
			expiresAt: Date.now() + t.expires_in * 1000,
		};
		if (!scopes.includes(SIWC.planScope)) {
			// Not a plan pass: it is not kept, and its refresh token is revoked at once.
			yield* revokeNow(held);
			return yield* Effect.fail({_tag: "no_scope" as const, why: "no chatgpt.tokens.use.direct"});
		}
		if (!(yield* vault.put(held))) {
			// The box was told to end while the trade was out: what came back is revoked, not kept.
			yield* revokeNow(held);
			return yield* Effect.fail({_tag: "closed" as const, why: "the vault is closed"});
		}
		s.say({
			ev: kind === "trade" ? "signed" : "refreshed",
			length: t.access_token.length,
			expires_in: t.expires_in,
			scopes,
			renewal: t.refresh_token !== undefined,
		});
		return {expires_in: t.expires_in, scopes, refreshInMs: refreshInMs(t.expires_in, s.marginMs)};
	});

/**
 * RFC 7009: the refresh token, its hint and the issued client. `true`: the server said 200. With
 * no refresh token there is nothing OpenAI documents to revoke: the pass lives out its hour.
 */
const revokeNow = (h: {
	readonly refresh: Redacted.Redacted<string> | null;
	readonly client: string;
}) =>
	Effect.gen(function* () {
		const {auth} = yield* Box;
		const rt = h.refresh;
		if (auth.revoke === null || rt === null) return false;
		return yield* postForm(auth.revoke, {
			token: Redacted.value(rt),
			token_type_hint: "refresh_token",
			client_id: h.client,
		}).pipe(
			Effect.as(true),
			Effect.retry({times: 2}),
			Effect.orElseSucceed(() => false),
		);
	});

export const tradeCell = (cmd: ReturnType<typeof trade>) =>
	Effect.gen(function* () {
		const s = yield* Box;
		const vault = yield* Vault;
		const pending = yield* vault.takePending;
		if (pending === null)
			return yield* Effect.fail({_tag: "closed" as const, why: "no verifier: traded already"});
		// A first registration issues a client id in the callback; a saved client's callback may omit it.
		const client = pending.client === SIWC.dynamicClient ? cmd.client : pending.client;
		if (client === null)
			return yield* Effect.fail({_tag: "refused" as const, why: "no issued client id came back"});
		const text = yield* postForm(s.auth.token, {
			grant_type: "authorization_code",
			client_id: client,
			code: cmd.code,
			code_verifier: Redacted.value(pending.verifier),
			redirect_uri: pending.redirect,
			resource: SIWC.resource,
		});
		return yield* keep(text, client, "trade");
	});

export const refreshCell = (_: ReturnType<typeof refresh>) =>
	Effect.gen(function* () {
		const s = yield* Box;
		const vault = yield* Vault;
		const h = yield* vault.held;
		if (h === null) return yield* Effect.fail({_tag: "closed" as const, why: "nothing held"});
		if (h.refresh === null)
			return yield* Effect.fail({_tag: "no_renewal" as const, why: "no refresh token"});
		const text = yield* postForm(s.auth.token, {
			grant_type: "refresh_token",
			client_id: h.client,
			refresh_token: Redacted.value(h.refresh),
			resource: SIWC.resource,
		});
		return yield* keep(text, h.client, "refresh");
	});

export const forgetCell = (cmd: ReturnType<typeof forget>) =>
	Effect.gen(function* () {
		const s = yield* Box;
		const vault = yield* Vault;
		const h = yield* vault.close;
		const revoked = h === null ? false : yield* revokeNow(h);
		s.say({ev: "forgotten", why: cmd.why, revoked, held: h !== null});
		yield* tellPerson(
			{kind: "sign_in_ended", box: s.box, why: cmd.why, revoked},
			`${s.box}/ended`,
		).pipe(Effect.ignore);
		return {revoked};
	});

const toBoxOf = Schema.decodeUnknownExit(Schema.fromJsonString(ToBox));

const signInMsgOf = (m: ToBox): SignInMsg | null => {
	switch (m.kind) {
		case "catcher":
			return {type: "catcher", port: m.port};
		case "code":
			return {type: "code", state: m.state, code: m.code, client: m.client};
		case "denied":
			return {type: "denied", state: m.state, error: m.error};
		case "end":
			return {type: "end"};
		default:
			return null;
	}
};

/** The box's inbox, read every 200 ms from where it was last read; each row one Msg, or none. */
export const readInbox = <M>(msgOf: (m: ToBox) => M | null) =>
	Stream.unwrap(
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const {box} = yield* Box;
			const inbox = streams(boxName(box)).inbox;
			let rev = 0;
			return Stream.tick(Duration.millis(200)).pipe(
				Stream.mapEffect(() =>
					ledger.readStream(inbox, rev, 100).pipe(Effect.orElseSucceed(() => [] as const)),
				),
				Stream.flatMap((rows) => {
					const last = rows.at(-1);
					if (last !== undefined) rev = last.rev;
					return Stream.fromIterable(
						rows.flatMap((r) => {
							const read = toBoxOf(r.data);
							const m = read._tag === "Success" ? msgOf(read.value) : null;
							return m === null ? [] : [m];
						}),
					);
				}),
			);
		}),
	);

export const inboxRunner = (_: InboxSub) => readInbox(signInMsgOf);
