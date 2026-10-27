// Experiment 154's words on the wire: the rows the box and the person's app leave on the ledger,
// and the sign-in's fixed names. Every row is data with a schema, and none can hold a token: the
// widest field is `url`, the sign-in page, and `code`, a one-time code worth nothing without the
// box's own PKCE verifier (RFC 7636), which never leaves the box.
//
//   box  -> person   {kind: "sign_in_wanted", box}
//   app  -> box      {kind: "catcher", port}                      the app's loopback port (RFC 8252)
//   box  -> person   {kind: "sign_in_url", box, url}
//   app  -> box      {kind: "code", state, code, client}          or {kind: "denied", state, error}
//   box  -> person   {kind: "signed_in", box, scopes, expires_in}
//   box  -> person   {kind: "sign_in_ended", box, why, revoked}
//   anyone -> box    {kind: "end"}
//
// Way (c), the person's app holds the sign-in and lends passes:
//   box  -> person   {kind: "pass_wanted", box, turn, key}           key: the box's public key
//   app  -> box      {kind: "pass", turn, sealed, expires_in, scopes} sealed to that key
//   app  -> box      {kind: "no_pass", turn, why}
import {Schema} from "effect";

/** OpenAI's names, from its SIWC "Registration and sign-in" page and pi's openai-chatgpt.ts. */
export const SIWC = {
	dynamicClient: "dynamic_agent_client",
	resource: "https://api.openai.com/v1",
	scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
	/** Way (b): no `offline_access`, so no refresh token. Whether OpenAI grants this is not documented. */
	scopeNoRenewal: "openid profile email resource.invoke chatgpt.tokens.use.direct",
	planScope: "chatgpt.tokens.use.direct",
	callbackPath: "/auth/callback",
	/** The Codex CLI's login port too: an app that finds it taken tries another (only the port may vary). */
	port: 1455,
	/** pi refreshes this long before the expiry, so a call never starts on a pass about to end. */
	marginMs: 3 * 60 * 1000,
} as const;

/** Where the box and the app find the sign-in: OpenAI's, or the fake's on this laptop. */
export const Auth = Schema.Struct({
	/** The page the person opens. */
	authorize: Schema.String,
	/** Where the box trades a code and refreshes. */
	token: Schema.String,
	/** RFC 7009 revocation, from the discovery document. `null`: none known. */
	revoke: Schema.NullOr(Schema.String),
	/** The Responses API's base. */
	api: Schema.String,
});
export type Auth = typeof Auth.Type;

export const openai: Auth = {
	authorize: "https://auth.openai.com/api/accounts/authorize",
	token: "https://auth.openai.com/api/accounts/oauth/token",
	// OpenAI's "Accounts and sessions" page: the revocation_endpoint from
	// https://auth.openai.com/.well-known/openid-configuration. The live runner reads it there.
	revoke: null,
	api: "https://api.openai.com/v1",
};

/** One row to the person's own inbox. */
export const ToPerson = Schema.Union([
	Schema.Struct({kind: Schema.Literal("sign_in_wanted"), box: Schema.String}),
	Schema.Struct({kind: Schema.Literal("sign_in_url"), box: Schema.String, url: Schema.String}),
	Schema.Struct({
		kind: Schema.Literal("signed_in"),
		box: Schema.String,
		scopes: Schema.Array(Schema.String),
		expires_in: Schema.Number,
	}),
	Schema.Struct({
		kind: Schema.Literal("sign_in_ended"),
		box: Schema.String,
		why: Schema.String,
		revoked: Schema.Boolean,
	}),
	// Way (c): the box asks the person's app for a pass, sealed to `key` (./seal.ts).
	Schema.Struct({
		kind: Schema.Literal("pass_wanted"),
		box: Schema.String,
		turn: Schema.Int,
		/** The box's public ECDH key, a JWK as JSON. */
		key: Schema.String,
	}),
]);
export type ToPerson = typeof ToPerson.Type;

/** One row to a box's inbox. */
export const ToBox = Schema.Union([
	Schema.Struct({kind: Schema.Literal("catcher"), port: Schema.Int}),
	Schema.Struct({
		kind: Schema.Literal("code"),
		state: Schema.String,
		code: Schema.String,
		/** The client id OpenAI issued on a first registration. `null`: a sign-in on a saved client. */
		client: Schema.NullOr(Schema.String),
	}),
	Schema.Struct({kind: Schema.Literal("denied"), state: Schema.String, error: Schema.String}),
	Schema.Struct({kind: Schema.Literal("end")}),
	// Way (c): a pass from the person's app, sealed to this box and turn. Never a refresh token.
	Schema.Struct({
		kind: Schema.Literal("pass"),
		turn: Schema.Int,
		sealed: Schema.String,
		expires_in: Schema.Number,
		scopes: Schema.Array(Schema.String),
	}),
	Schema.Struct({kind: Schema.Literal("no_pass"), turn: Schema.Int, why: Schema.String}),
]);
export type ToBox = typeof ToBox.Type;

/** The ledger's names: one per person, one per box, each with its inbox. */
export const personName = (who: string) => `signin/person/${who}`;
export const boxName = (box: string) => `signin/box/${box}`;

/** The redirect the person's app catches, on its own loopback (RFC 8252 section 7.3). */
export const redirectOf = (port: number) => `http://127.0.0.1:${port}${SIWC.callbackPath}`;
