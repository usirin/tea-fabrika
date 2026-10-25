import {describe, expect, it} from "@effect/vitest";
import {Clock, Effect, Layer, Logger, Redacted} from "effect";
import {FetchHttpClient} from "effect/http";
import {TestClock} from "effect/testing";
import {Keys} from "./keys.ts";
import {
	isLogin,
	KEYS_CACHE_MS,
	KEYS_FAIL_MS,
	LIMIT_WAIT_MS,
	layerGitHub,
	limitWait,
	numberOf,
	TOKEN_REFUSED,
} from "./keys-github.ts";

// GitHub's answer to `Keys`, against a fake api.github.com: what it asks, what it gives back, how
// long it keeps an answer, and the token it sends. Nothing leaves this process. The door itself is
// `door.test.ts`; the two together in workerd are `door-wire.test.ts`.

const TOKEN = "github_pat_fake_for_the_test";

const fakeGitHub = () => {
	const users = new Map<string, {id: number; keys: string[]}>();
	const state = {
		asked: [] as string[],
		/** The `authorization` header of each call, in order: null for none. */
		auth: [] as (string | null)[],
		status: 200,
		/** The headers GitHub sends with a refusal, such as `x-ratelimit-remaining`. */
		headers: {} as Record<string, string>,
		/** A token GitHub no longer takes: a call with it gets 401. */
		dead: false,
		logs: [] as string[],
	};
	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const req = new Request(input, init);
		const url = new URL(req.url);
		state.asked.push(url.pathname);
		const auth = req.headers.get("authorization");
		state.auth.push(auth);
		if (state.dead && auth !== null)
			return Response.json({message: "Bad credentials"}, {status: 401});
		if (state.status !== 200)
			return new Response("no", {status: state.status, headers: state.headers});
		if (url.host !== "api.github.com") return Response.json({message: "Not Found"}, {status: 404});
		const byId = /^\/user\/([0-9]+)$/.exec(url.pathname);
		if (byId !== null) {
			const found = [...users].find(([, u]) => u.id === Number(byId[1]));
			return found === undefined
				? Response.json({message: "Not Found"}, {status: 404})
				: Response.json({id: found[1].id, login: found[0]});
		}
		const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
		const login = m?.[1] === undefined ? "" : decodeURIComponent(m[1]);
		const u = users.get(login);
		if (u === undefined) return Response.json({message: "Not Found"}, {status: 404});
		return m?.[2] === undefined
			? Response.json({id: u.id, login})
			: Response.json(u.keys.map((key, i) => ({id: i + 1, key})));
	};
	const layer = (o: {cacheMs?: number; failMs?: number; token?: string} = {}) =>
		Layer.mergeAll(
			layerGitHub({
				...(o.cacheMs === undefined ? {} : {cacheMs: o.cacheMs}),
				...(o.failMs === undefined ? {} : {failMs: o.failMs}),
				...(o.token === undefined ? {} : {token: Redacted.make(o.token)}),
			}).pipe(
				Layer.provide(FetchHttpClient.layer),
				Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch)),
			),
			Logger.layer([Logger.make((l) => state.logs.push(String(l.message)))]),
		);
	return {users, state, layer};
};

const of = (name: string) => Keys.use((k) => k.of(name));
const byId = (id: string) => Keys.use((k) => k.byId(id));

describe("GitHub's keys", () => {
	it.effect("gives GitHub's numeric id, never the login, and the keys GitHub lists", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA1", "ssh-ed25519 AAAA2"]});
		return Effect.gen(function* () {
			expect(yield* of("alice")).toEqual({
				id: "github:7",
				name: "alice",
				keys: ["ssh-ed25519 AAAA1", "ssh-ed25519 AAAA2"],
			});
			expect(gh.state.asked.sort()).toEqual(["/users/alice", "/users/alice/keys"]);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
	});

	it.effect("finds a person by id, under the login they have now", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA1"]});
		return Effect.gen(function* () {
			expect(yield* byId("github:7")).toEqual({
				id: "github:7",
				name: "alice",
				keys: ["ssh-ed25519 AAAA1"],
			});
			gh.users.delete("alice");
			gh.users.set("alice-new", {id: 7, keys: ["ssh-ed25519 AAAA1"]});
			expect(yield* byId("github:7")).toMatchObject({id: "github:7", name: "alice-new"});
			expect(yield* byId("github:8")).toBeNull();
			expect(gh.state.asked).toEqual([
				"/user/7",
				"/users/alice/keys",
				"/user/7",
				"/users/alice-new/keys",
				"/user/8",
			]);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
	});

	it.effect("asks nothing for an id that is not GitHub's", () => {
		const gh = fakeGitHub();
		return Effect.gen(function* () {
			for (const id of ["ledger:7", "github:", "github:07", "github:-1", "github:1e3", "7"])
				expect(yield* byId(id)).toBeNull();
			expect(gh.state.asked).toEqual([]);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
	});

	it.effect("keeps the id when the login is renamed, and the old login is nobody", () => {
		const gh = fakeGitHub();
		gh.users.set("robert", {id: 8, keys: []});
		return Effect.gen(function* () {
			expect(yield* of("robert")).toEqual({id: "github:8", name: "robert", keys: []});
			expect(yield* of("bob")).toBeNull();
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
	});

	it.effect("asks nothing for a name that is no GitHub login", () => {
		const gh = fakeGitHub();
		return Effect.gen(function* () {
			for (const name of ["-alice", "a--b", "a/b", "x".repeat(40), "github:7"])
				expect(yield* of(name)).toBeNull();
			expect(gh.state.asked).toEqual([]);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
	});

	it.effect("fails as unreachable on a GitHub error, and keeps the failure a short time", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		gh.state.status = 503;
		return Effect.gen(function* () {
			const down = yield* Effect.flip(of("alice"));
			expect(down._tag).toBe("KeysUnreachable");
			expect(down.why).toContain("503");
			expect(gh.state.asked).toHaveLength(2);
			gh.state.status = 200;
			// Kept: the same failure, and GitHub is not asked again.
			yield* TestClock.adjust(KEYS_FAIL_MS - 1);
			expect((yield* Effect.flip(of("alice"))).why).toBe(down.why);
			expect(gh.state.asked).toHaveLength(2);
			yield* TestClock.adjust(1);
			expect(yield* of("alice")).toEqual({id: "github:7", name: "alice", keys: []});
			expect(gh.state.asked).toHaveLength(4);
		}).pipe(Effect.provide(gh.layer()));
	});

	it.effect("keeps a failure for failMs, and none at 0", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		gh.state.status = 503;
		return Effect.gen(function* () {
			for (const failMs of [1000, 0]) {
				gh.state.asked.length = 0;
				gh.state.status = 503;
				const keys = yield* Layer.build(gh.layer({cacheMs: 0, failMs}));
				const ask = byId("github:7").pipe(Effect.flip, Effect.provide(keys));
				yield* ask;
				yield* ask;
				expect(gh.state.asked).toEqual(failMs === 0 ? ["/user/7", "/user/7"] : ["/user/7"]);
				gh.state.status = 200;
				yield* TestClock.adjust(failMs);
				expect(yield* byId("github:7").pipe(Effect.provide(keys))).toMatchObject({id: "github:7"});
			}
		}).pipe(Effect.scoped);
	});

	it.effect("says a limit hit is a limit, with the calls GitHub says are left", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			for (const status of [403, 429]) {
				gh.state.status = status;
				gh.state.headers = {"x-ratelimit-remaining": "0"};
				expect((yield* Effect.flip(byId("github:7"))).why).toBe(
					`GitHub answered ${status} for /user/7 (rate limit: 0 calls left)`,
				);
			}
			gh.state.headers = {};
			expect((yield* Effect.flip(byId("github:7"))).why).toBe("GitHub answered 429 for /user/7");
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, failMs: 0})));
	});

	it.effect("asks nothing while GitHub's limit is spent, for any id, until its reset", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		gh.users.set("bob", {id: 8, keys: []});
		return Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis;
			gh.state.status = 403;
			gh.state.headers = {
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(Math.floor(now / 1000) + 60),
			};
			yield* Effect.flip(byId("github:7"));
			expect(gh.state.asked).toEqual(["/user/7"]);
			gh.state.status = 200;
			// Spent for everyone: another id, and a name, are not asked about either.
			const later = yield* Effect.flip(byId("github:8"));
			expect(later._tag).toBe("KeysUnreachable");
			expect(later.why).toContain("rate limit is spent until");
			expect((yield* Effect.flip(of("alice")))._tag).toBe("KeysUnreachable");
			yield* TestClock.adjust(59_999);
			yield* Effect.flip(byId("github:7"));
			expect(gh.state.asked).toEqual(["/user/7"]);
			yield* TestClock.adjust(1);
			expect(yield* byId("github:8")).toMatchObject({id: "github:8", name: "bob"});
			expect(gh.state.asked).toEqual(["/user/7", "/user/8", "/users/bob/keys"]);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, failMs: 0})));
	});

	it.effect("waits as long as retry-after says", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			gh.state.status = 429;
			gh.state.headers = {"retry-after": "5"};
			yield* Effect.flip(byId("github:7"));
			gh.state.status = 200;
			yield* TestClock.adjust(4_999);
			yield* Effect.flip(byId("github:7"));
			expect(gh.state.asked).toEqual(["/user/7"]);
			yield* TestClock.adjust(1);
			expect(yield* byId("github:7")).toMatchObject({id: "github:7"});
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, failMs: 0})));
	});

	it.effect("asks again at the wait's end, even about a question asked just before it", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			gh.state.status = 403;
			gh.state.headers = {"retry-after": "1"};
			yield* Effect.flip(byId("github:7"));
			gh.state.status = 200;
			yield* TestClock.adjust(999);
			expect((yield* Effect.flip(of("alice"))).why).toContain("rate limit is spent until");
			expect(gh.state.asked).toEqual(["/user/7"]);
			yield* TestClock.adjust(1);
			expect(yield* of("alice")).toEqual({id: "github:7", name: "alice", keys: []});
			expect(gh.state.asked).toHaveLength(3);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, failMs: 2})));
	});

	it.effect("still keeps GitHub's own limit refusal for failMs, past the wait's end", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			gh.state.status = 403;
			gh.state.headers = {"retry-after": "1"};
			const refused = yield* Effect.flip(byId("github:7"));
			expect(refused.why).toBe("GitHub answered 403 for /user/7");
			gh.state.status = 200;
			yield* TestClock.adjust(4_999);
			expect((yield* Effect.flip(byId("github:7"))).why).toBe(refused.why);
			expect(gh.state.asked).toEqual(["/user/7"]);
			yield* TestClock.adjust(1);
			expect(yield* byId("github:7")).toMatchObject({id: "github:7"});
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, failMs: 5_000})));
	});

	it.effect("ends the wait on time under the default failMs, at the one-hour cap", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			gh.state.status = 429;
			gh.state.headers = {"retry-after": String(LIMIT_WAIT_MS)};
			yield* Effect.flip(byId("github:7"));
			gh.state.status = 200;
			yield* TestClock.adjust(LIMIT_WAIT_MS - 1);
			yield* Effect.flip(of("alice"));
			yield* TestClock.adjust(1);
			expect(yield* of("alice")).toMatchObject({id: "github:7"});
		}).pipe(Effect.provide(gh.layer()));
	});

	it.effect("waits for nothing on a refusal that names no spent limit", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			for (const [status, headers] of [
				[503, {"retry-after": "60"}],
				[403, {}],
				[403, {"x-ratelimit-remaining": "12", "x-ratelimit-reset": "9999999999"}],
			] as const) {
				gh.state.status = status;
				gh.state.headers = headers;
				yield* Effect.flip(byId("github:7"));
			}
			gh.state.status = 200;
			expect(yield* byId("github:7")).toMatchObject({id: "github:7"});
			expect(gh.state.asked).toHaveLength(5);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, failMs: 0})));
	});

	it.effect("fails as unreachable on an answer that does not read", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 1.5, keys: []});
		return Effect.gen(function* () {
			const bad = yield* Effect.flip(of("alice"));
			expect(bad._tag).toBe("KeysUnreachable");
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
	});

	it.effect("asks GitHub once in its cache time, and again after", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA1"]});
		return Effect.gen(function* () {
			yield* of("alice");
			yield* byId("github:7");
			gh.users.set("alice", {id: 7, keys: []});
			// Taken off on GitHub, still in the copy here: the old answer, until the copy is old.
			expect((yield* of("alice"))?.keys).toEqual(["ssh-ed25519 AAAA1"]);
			expect((yield* byId("github:7"))?.keys).toEqual(["ssh-ed25519 AAAA1"]);
			expect(gh.state.asked).toHaveLength(4);
			yield* TestClock.adjust(KEYS_CACHE_MS);
			expect((yield* of("alice"))?.keys).toEqual([]);
			expect((yield* byId("github:7"))?.keys).toEqual([]);
			expect(gh.state.asked).toHaveLength(8);
		}).pipe(Effect.provide(gh.layer()));
	});
});

describe("GitHub's keys with a token", () => {
	it.effect("sends the token as a bearer header on every call", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			yield* of("alice");
			yield* byId("github:7");
			expect(gh.state.auth).toEqual(Array(4).fill(`Bearer ${TOKEN}`));
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, token: TOKEN})));
	});

	it.effect("sends no authorization header without one", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			yield* of("alice");
			yield* byId("github:7");
			expect(gh.state.auth).toEqual([null, null, null, null]);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
	});

	it.effect("asks once more without a token GitHub refuses, and says so in the log", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA1"]});
		gh.state.dead = true;
		return Effect.gen(function* () {
			expect(yield* byId("github:7")).toEqual({
				id: "github:7",
				name: "alice",
				keys: ["ssh-ed25519 AAAA1"],
			});
			// Each call: once with the token, refused, then once without.
			expect(gh.state.asked).toEqual([
				"/user/7",
				"/user/7",
				"/users/alice/keys",
				"/users/alice/keys",
			]);
			expect(gh.state.auth).toEqual([`Bearer ${TOKEN}`, null, `Bearer ${TOKEN}`, null]);
			expect(gh.state.logs).toEqual([TOKEN_REFUSED, TOKEN_REFUSED]);
			expect(gh.state.logs.join("\n")).not.toContain(TOKEN);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, token: TOKEN})));
	});

	it.effect("asks no second time on a 401 without a token, and stays unreachable", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		gh.state.status = 401;
		return Effect.gen(function* () {
			const e = yield* Effect.flip(byId("github:7"));
			expect(e._tag).toBe("KeysUnreachable");
			expect(e.why).toBe("GitHub answered 401 for /user/7");
			expect(gh.state.asked).toEqual(["/user/7"]);
			expect(gh.state.logs).toEqual([]);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
	});

	it.effect("puts the token in no error", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		gh.state.status = 503;
		return Effect.gen(function* () {
			const e = yield* Effect.flip(byId("github:7"));
			expect(JSON.stringify(e)).not.toContain(TOKEN);
			expect(String(e)).not.toContain(TOKEN);
		}).pipe(Effect.provide(gh.layer({cacheMs: 0, token: TOKEN})));
	});
});

describe("how long GitHub says to wait", () => {
	const now = 1_000_000_000_000;
	it("reads retry-after in seconds, or as a date", () => {
		expect(limitWait(429, {"retry-after": "5"}, now)).toBe(5000);
		expect(limitWait(403, {"retry-after": new Date(now + 7000).toUTCString()}, now)).toBe(7000);
	});
	it("reads the reset when no calls are left", () => {
		const reset = String(now / 1000 + 90);
		expect(limitWait(403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": reset}, now)).toBe(
			90_000,
		);
		expect(limitWait(403, {"x-ratelimit-remaining": "3", "x-ratelimit-reset": reset}, now)).toBe(
			null,
		);
	});
	it("waits at most an hour, never less than nothing, and only on 403 or 429", () => {
		expect(limitWait(429, {"retry-after": "999999"}, now)).toBe(LIMIT_WAIT_MS);
		expect(limitWait(403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1"}, now)).toBe(0);
		expect(limitWait(503, {"retry-after": "5"}, now)).toBe(null);
		expect(limitWait(403, {"retry-after": "soon"}, now)).toBe(null);
	});
	it("reads digits as seconds, never as a year", () => {
		expect(limitWait(429, {"retry-after": "2027"}, now)).toBe(2_027_000);
	});
	it.each([
		"1.5",
		"-5",
		"+5",
		"2027-01-01",
		"June 2027",
		"5s",
		"0x10",
		"1e3",
		"Sun, 06 Nov 1994",
		"tomorrow",
	])("reads retry-after %s as no header", (after) => {
		expect(limitWait(429, {"retry-after": after}, now)).toBe(null);
		// And falls through to the reset, as with no retry-after at all.
		const reset = String(now / 1000 + 90);
		const headers = {
			"retry-after": after,
			"x-ratelimit-remaining": "0",
			"x-ratelimit-reset": reset,
		};
		expect(limitWait(403, headers, now)).toBe(90_000);
	});
	it.each(["12.5", "-1", "1e12", "+99", "0x1"])(
		"reads x-ratelimit-reset %s as no header",
		(reset) => {
			expect(limitWait(403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": reset}, now)).toBe(
				null,
			);
		},
	);
	it("reads all three HTTP-date forms, and no others", () => {
		// 2001-09-09T01:46:47Z is now + 7 s.
		for (const date of [
			"Sun, 09 Sep 2001 01:46:47 GMT",
			"Sunday, 09-Sep-01 01:46:47 GMT",
			"Sun Sep  9 01:46:47 2001",
		])
			expect(limitWait(429, {"retry-after": date}, now)).toBe(7000);
		for (const date of [
			"Sun, 9 Sep 2001 01:46:47 GMT",
			"Sun, 09 Sep 2001 01:46:47 UTC",
			"sun, 09 sep 2001 01:46:47 gmt",
			"Sun, 31 Feb 2001 01:46:47 GMT",
			"Sun, 09 Sep 2001 24:00:00 GMT",
			"2001-09-09T01:46:47Z",
			"Sun Sep 09 01:46:47 2001 GMT",
		])
			expect(limitWait(429, {"retry-after": date}, now)).toBe(null);
	});
	it("takes a two-digit year as the latest, never more than 50 years ahead", () => {
		const at = Date.UTC(2026, 0, 1);
		const wait = (yy: string) =>
			limitWait(429, {"retry-after": `Thursday, 01-Jan-${yy} 00:00:05 GMT`}, at);
		expect(wait("26")).toBe(5000);
		// 2075 is less than 50 years ahead; 2077 is more: that is 1977, gone, so no wait.
		expect(wait("75")).toBe(LIMIT_WAIT_MS);
		expect(wait("77")).toBe(0);
	});
	it("draws the 50-year line by the time, not the year", () => {
		const at = Date.UTC(2027, 0, 15);
		const wait = (time: string) =>
			limitWait(429, {"retry-after": `Friday, 15-Jan-77 ${time} GMT`}, at);
		// Exactly 50 years ahead is still 2077: the longest wait.
		expect(wait("00:00:00")).toBe(LIMIT_WAIT_MS);
		// One second more is past the line: 1977, gone, so no wait.
		expect(wait("00:00:01")).toBe(0);
	});
});

describe("a GitHub login", () => {
	it.each(["alice", "a-b", "A1", "x".repeat(39)])("is %s", (s) => {
		expect(isLogin(s)).toBe(true);
	});
	it.each(["", "-a", "a-", "a--b", "a_b", "x".repeat(40), 7])("is not %s", (s) => {
		expect(isLogin(s)).toBe(false);
	});
});

describe("a GitHub id", () => {
	it("is github: and GitHub's number", () => {
		expect(numberOf("github:7")).toBe(7);
		expect(numberOf("github:123456789")).toBe(123456789);
		expect(numberOf("github:99999999999999999")).toBeNull();
	});
});
