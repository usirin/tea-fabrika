// `Keys` from GitHub: a name is a GitHub login, its keys are the ones GitHub lists for it
// (`GET /users/{login}/keys`), and its id is GitHub's numeric user id, as `github:<n>`. The numeric
// id is kept, not the login: a login can be renamed, and then given to someone else, and the
// ledger must not take the new owner for the old.
//
//   byId("github:7")   GET /user/7 (the login it has now), then GET /users/{that login}/keys
//   of("alice")        GET /users/alice and GET /users/alice/keys, together
//
//   layerGitHub()                              no token: 60 calls an hour from one address
//   layerGitHub({token: Redacted.make(t)})     its own budget: 5,000 calls an hour
//   layerGitHub({cacheMs: 0, failMs: 0})       asks GitHub every time
//
// Each question costs two calls. Without a token, GitHub's limit counts calls by address, and a
// Worker's outgoing address is shared with other sites, so the budget may be spent before the
// ledger asks. With a token the ledger has its own. The token is only ever sent as
// `authorization: Bearer ...`, and never logged or put in an error. A call GitHub refuses the token
// on (401: it expired, or was taken back) is asked once more without it, with a warning in the log, so a dead
// token slows sign-in down to the shared limit instead of stopping it.
//
// Answers are kept for `cacheMs` (`KEYS_CACHE_MS`, 5 minutes, by default). A key taken off on
// GitHub still signs in until the copy here is that old. A failed answer is kept for `failMs`
// (`KEYS_FAIL_MS`, 30 seconds), so a login while GitHub fails does not ask it again at once.
//
// When GitHub says the calls are spent (a 403 or 429 with `retry-after`, or with
// `x-ratelimit-remaining: 0` and `x-ratelimit-reset`), nothing is asked until the time it names,
// at most an hour, and every question fails as unreachable till then. One wait for the whole Layer,
// since the limit is one budget for every call.
//
// https://docs.github.com/en/rest/users/users#get-a-user-using-their-id
// https://docs.github.com/en/rest/users/users#get-a-user
// https://docs.github.com/en/rest/users/keys#list-public-keys-for-a-user
// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
import {Cache, Clock, Duration, Effect, Exit, Layer, type Redacted, Ref, Schema} from "effect";
import {HttpClient, HttpClientRequest, HttpClientResponse} from "effect/http";
import {Keys, KeysUnreachable, type Signers} from "./keys.ts";

/** How long an answer from GitHub is kept, by default: 5 minutes. */
export const KEYS_CACHE_MS = 5 * 60_000;
/** How long a failed answer is kept, by default: 30 seconds. */
export const KEYS_FAIL_MS = 30_000;
/** The longest wait for a spent rate limit: GitHub's limit is counted by the hour. */
export const LIMIT_WAIT_MS = 60 * 60_000;

/**
 * How long GitHub says to wait before the next call, from a refusal's headers, in ms from `now`;
 * null when it says nothing of a spent limit. `retry-after` first (seconds, or an HTTP date), then
 * `x-ratelimit-reset` (seconds since 1970) when `x-ratelimit-remaining` is 0. At most
 * `LIMIT_WAIT_MS`.
 */
export const limitWait = (
	status: number,
	headers: Readonly<Record<string, string | undefined>>,
	now: number,
): number | null => {
	if (status !== 403 && status !== 429) return null;
	const after = headers["retry-after"]?.trim() ?? "";
	const reset = headers["x-ratelimit-reset"]?.trim() ?? "";
	const at = /^[0-9]{1,10}$/.test(after)
		? now + Number(after) * 1000
		: after !== "" && !Number.isNaN(Date.parse(after))
			? Date.parse(after)
			: headers["x-ratelimit-remaining"]?.trim() === "0" && /^[0-9]{1,12}$/.test(reset)
				? Number(reset) * 1000
				: null;
	return at === null ? null : Math.min(Math.max(at - now, 0), LIMIT_WAIT_MS);
};

/** A GitHub login as GitHub allows it: letters, digits and single dashes, up to 39. */
export const isLogin = (s: unknown): s is string =>
	typeof s === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(s);

/** A person's id from GitHub: their numeric user id, which a rename does not change. */
export const githubId = (n: number): string => `github:${n}`;

/** The number in a GitHub id (`github:7` is 7); null for any other id. */
export const numberOf = (id: string): number | null => {
	const n = /^github:([1-9][0-9]{0,15})$/.exec(id)?.[1];
	return n === undefined || !Number.isSafeInteger(Number(n)) ? null : Number(n);
};

/** What the log says when GitHub refuses the token. It never holds the token. */
export const TOKEN_REFUSED = "the GitHub token was refused; asking without it";

export interface GitHubOptions {
	/** How long an answer is kept, in ms. Default `KEYS_CACHE_MS`; 0 asks every time. */
	readonly cacheMs?: number;
	/** How long a failed answer is kept, in ms. Default `KEYS_FAIL_MS`; 0 keeps none. */
	readonly failMs?: number;
	/**
	 * A token for GitHub's API, for a budget of its own (5,000 calls an hour). It needs no
	 * permission: a fine-grained token with public read only. Left out: no `authorization` header.
	 */
	readonly token?: Redacted.Redacted<string>;
}

const User = Schema.Struct({id: Schema.Int, login: Schema.String});
const KeyList = Schema.Array(Schema.Struct({key: Schema.String}));

export const layerGitHub = (
	o: GitHubOptions = {},
): Layer.Layer<Keys, never, HttpClient.HttpClient> =>
	Layer.effect(
		Keys,
		Effect.gen(function* () {
			const http = (yield* HttpClient.HttpClient).pipe(
				HttpClient.mapRequest(
					HttpClientRequest.setHeaders({
						accept: "application/vnd.github+json",
						"user-agent": "fabrika-ledger",
						"x-github-api-version": "2022-11-28",
					}),
				),
			);
			/** One GET, with the token when there is one. */
			const send = (path: string, token: Redacted.Redacted<string> | undefined) => {
				const req = HttpClientRequest.get(`https://api.github.com${path}`);
				return http.execute(token === undefined ? req : HttpClientRequest.bearerToken(req, token));
			};
			/** No call goes out before this time, in ms: GitHub said the limit is spent till then. */
			const waitUntil = yield* Ref.make(0);
			/** One GET, read with `schema`; null on a 404. */
			const get = <A>(
				path: string,
				schema: Schema.Codec<A, unknown>,
			): Effect.Effect<A | null, KeysUnreachable> =>
				Effect.gen(function* () {
					const until = yield* Ref.get(waitUntil);
					if ((yield* Clock.currentTimeMillis) < until)
						return yield* new KeysUnreachable({
							why: `GitHub's rate limit is spent until ${new Date(until).toISOString()}; not asked for ${path}`,
						});
					let res = yield* send(path, o.token);
					if (res.status === 401 && o.token !== undefined) {
						yield* Effect.logWarning(TOKEN_REFUSED);
						res = yield* send(path, undefined);
					}
					if (res.status === 404) return null;
					if (res.status < 200 || res.status >= 300) {
						const now = yield* Clock.currentTimeMillis;
						const wait = limitWait(res.status, res.headers, now);
						if (wait !== null) yield* Ref.update(waitUntil, (u) => Math.max(u, now + wait));
						// A limit hit reads as a limit, not as GitHub being down.
						const left = res.headers["x-ratelimit-remaining"];
						const limit =
							(res.status === 403 || res.status === 429) && left !== undefined
								? ` (rate limit: ${left} calls left)`
								: "";
						return yield* new KeysUnreachable({
							why: `GitHub answered ${res.status} for ${path}${limit}`,
						});
					}
					return yield* HttpClientResponse.schemaBodyJson(schema)(res);
				}).pipe(
					Effect.mapError((e) =>
						e instanceof KeysUnreachable
							? e
							: new KeysUnreachable({why: `GitHub, for ${path}: ${e.message}`}),
					),
				);
			const keysOf = (login: string) => get(`/users/${encodeURIComponent(login)}/keys`, KeyList);

			const of = (login: string): Effect.Effect<Signers | null, KeysUnreachable> => {
				// Not a login: nobody, and GitHub is not asked.
				if (!isLogin(login)) return Effect.succeed(null);
				return Effect.all([get(`/users/${encodeURIComponent(login)}`, User), keysOf(login)], {
					concurrency: 2,
				}).pipe(
					Effect.map(([user, keys]) =>
						user === null
							? null
							: {id: githubId(user.id), name: user.login, keys: (keys ?? []).map((k) => k.key)},
					),
				);
			};

			const byId = (id: string): Effect.Effect<Signers | null, KeysUnreachable> => {
				// Not GitHub's id: nobody, and GitHub is not asked.
				const n = numberOf(id);
				if (n === null) return Effect.succeed(null);
				return get(`/user/${n}`, User).pipe(
					Effect.flatMap((user) => {
						if (user === null) return Effect.succeed(null);
						if (user.id !== n || !isLogin(user.login))
							return Effect.fail(new KeysUnreachable({why: `GitHub gave another user for ${id}`}));
						// Renamed between the two calls: nobody by that login now. The next ask finds them.
						return keysOf(user.login).pipe(
							Effect.map((keys) =>
								keys === null ? null : {id, name: user.login, keys: keys.map((k) => k.key)},
							),
						);
					}),
				);
			};

			const ms = Math.max(o.cacheMs ?? KEYS_CACHE_MS, 0);
			const failMs = Math.max(o.failMs ?? KEYS_FAIL_MS, 0);
			if (ms === 0 && failMs === 0) return Keys.of({byId, of});
			// A time to live by how the question ended: zero keeps nothing.
			const keep = {
				capacity: 256,
				timeToLive: (exit: Exit.Exit<Signers | null, KeysUnreachable>) =>
					Duration.millis(Exit.isSuccess(exit) ? ms : failMs),
			};
			const ids = yield* Cache.makeWith(byId, keep);
			const names = yield* Cache.makeWith(of, keep);
			return Keys.of({
				byId: (id) => Cache.get(ids, id),
				of: (name) => Cache.get(names, name),
			});
		}),
	);
