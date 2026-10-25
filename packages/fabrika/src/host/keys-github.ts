// `Keys` from GitHub: a name is a GitHub login, its keys are the ones GitHub lists for it
// (`GET /users/{login}/keys`), and its id is GitHub's numeric user id (`GET /users/{login}`), as
// `github:<n>`. The numeric id is kept, not the login: a login can be renamed, and then given to
// someone else, and the ledger must not take the new owner for the old.
//
//   layerGitHub()                    {id: "github:7", keys: [...]} for "alice"; null for no such login
//   layerGitHub({cacheMs: 0})        asks GitHub every time
//
// No token: both calls are public. GitHub allows 60 of them an hour from one address without one,
// so answers are kept for `cacheMs` (`KEYS_CACHE_MS`, 5 minutes, by default). A key taken off on
// GitHub still signs in until the copy here is that old. A failed call is never kept.
//
// https://docs.github.com/en/rest/users/users#get-a-user
// https://docs.github.com/en/rest/users/keys#list-public-keys-for-a-user
import {Cache, Duration, Effect, Exit, Layer, Schema} from "effect";
import {HttpClient, HttpClientRequest, HttpClientResponse} from "effect/http";
import {Keys, KeysUnreachable, type Signers} from "./keys.ts";

/** How long an answer from GitHub is kept, by default: 5 minutes. */
export const KEYS_CACHE_MS = 5 * 60_000;

/** A GitHub login as GitHub allows it: letters, digits and single dashes, up to 39. */
export const isLogin = (s: unknown): s is string =>
	typeof s === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(s);

/** A person's id from GitHub: their numeric user id, which a rename does not change. */
export const githubId = (n: number): string => `github:${n}`;

export interface GitHubOptions {
	/** How long an answer is kept, in ms. Default `KEYS_CACHE_MS`; 0 asks every time. */
	readonly cacheMs?: number;
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
			/** One GET, read with `schema`; null on a 404. */
			const get = <A>(
				path: string,
				schema: Schema.Codec<A, unknown>,
			): Effect.Effect<A | null, KeysUnreachable> =>
				Effect.gen(function* () {
					const res = yield* http.get(`https://api.github.com${path}`);
					if (res.status === 404) return null;
					if (res.status < 200 || res.status >= 300)
						return yield* new KeysUnreachable({why: `GitHub answered ${res.status} for ${path}`});
					return yield* HttpClientResponse.schemaBodyJson(schema)(res);
				}).pipe(
					Effect.mapError((e) =>
						e instanceof KeysUnreachable
							? e
							: new KeysUnreachable({why: `GitHub, for ${path}: ${e.message}`}),
					),
				);
			const ask = (login: string): Effect.Effect<Signers | null, KeysUnreachable> => {
				// Not a login: nobody, and GitHub is not asked.
				if (!isLogin(login)) return Effect.succeed(null);
				const at = `/users/${encodeURIComponent(login)}`;
				return Effect.all([get(at, User), get(`${at}/keys`, KeyList)], {concurrency: 2}).pipe(
					Effect.map(([user, keys]) =>
						user === null ? null : {id: githubId(user.id), keys: (keys ?? []).map((k) => k.key)},
					),
				);
			};
			const ms = o.cacheMs ?? KEYS_CACHE_MS;
			if (ms <= 0) return Keys.of({of: ask});
			const cache = yield* Cache.makeWith(ask, {
				capacity: 256,
				timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.millis(ms) : Duration.zero),
			});
			return Keys.of({of: (name) => Cache.get(cache, name)});
		}),
	);
