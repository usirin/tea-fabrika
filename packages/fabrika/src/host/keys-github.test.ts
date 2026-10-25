import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Logger, Redacted} from "effect";
import {FetchHttpClient} from "effect/http";
import {TestClock} from "effect/testing";
import {Keys} from "./keys.ts";
import {isLogin, KEYS_CACHE_MS, layerGitHub, numberOf, TOKEN_REFUSED} from "./keys-github.ts";

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
		/** GitHub's `x-ratelimit-remaining` on a refusal; null sends none. */
		left: null as string | null,
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
			return new Response("no", {
				status: state.status,
				headers: state.left === null ? {} : {"x-ratelimit-remaining": state.left},
			});
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
	const layer = (o: {cacheMs?: number; token?: string} = {}) =>
		Layer.mergeAll(
			layerGitHub({
				...(o.cacheMs === undefined ? {} : {cacheMs: o.cacheMs}),
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

	it.effect("fails as unreachable on a GitHub error, and keeps no failure", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		gh.state.status = 503;
		return Effect.gen(function* () {
			const down = yield* Effect.flip(of("alice"));
			expect(down._tag).toBe("KeysUnreachable");
			expect(down.why).toContain("503");
			gh.state.status = 200;
			expect(yield* of("alice")).toEqual({id: "github:7", name: "alice", keys: []});
		}).pipe(Effect.provide(gh.layer()));
	});

	it.effect("says a limit hit is a limit, with the calls GitHub says are left", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: []});
		return Effect.gen(function* () {
			for (const status of [403, 429]) {
				gh.state.status = status;
				gh.state.left = "0";
				expect((yield* Effect.flip(byId("github:7"))).why).toBe(
					`GitHub answered ${status} for /user/7 (rate limit: 0 calls left)`,
				);
			}
			gh.state.left = null;
			expect((yield* Effect.flip(byId("github:7"))).why).toBe("GitHub answered 429 for /user/7");
		}).pipe(Effect.provide(gh.layer({cacheMs: 0})));
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
