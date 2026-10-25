import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer} from "effect";
import {FetchHttpClient} from "effect/http";
import {TestClock} from "effect/testing";
import {Keys} from "./keys.ts";
import {isLogin, KEYS_CACHE_MS, layerGitHub} from "./keys-github.ts";

// GitHub's answer to `Keys`, against a fake api.github.com: what it asks, what it gives back, how
// long it keeps an answer. Nothing leaves this process. The door itself is `door.test.ts`; the two
// together in workerd are `door-wire.test.ts`.

const fakeGitHub = () => {
	const users = new Map<string, {id: number; keys: string[]}>();
	const state = {asked: [] as string[], status: 200};
	const fetch = async (input: string | URL | Request): Promise<Response> => {
		const url = new URL(input instanceof Request ? input.url : input);
		state.asked.push(url.pathname);
		if (state.status !== 200) return new Response("no", {status: state.status});
		const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
		const login = m?.[1] === undefined ? "" : decodeURIComponent(m[1]);
		const u = users.get(login);
		if (url.host !== "api.github.com" || u === undefined)
			return Response.json({message: "Not Found"}, {status: 404});
		return m?.[2] === undefined
			? Response.json({id: u.id, login})
			: Response.json(u.keys.map((key, i) => ({id: i + 1, key})));
	};
	const layer = (cacheMs?: number) =>
		layerGitHub({...(cacheMs === undefined ? {} : {cacheMs})}).pipe(
			Layer.provide(FetchHttpClient.layer),
			Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch)),
		);
	return {users, state, layer};
};

const of = (name: string) => Keys.use((k) => k.of(name));

describe("GitHub's keys", () => {
	it.effect("gives GitHub's numeric id, never the login, and the keys GitHub lists", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA1", "ssh-ed25519 AAAA2"]});
		return Effect.gen(function* () {
			expect(yield* of("alice")).toEqual({
				id: "github:7",
				keys: ["ssh-ed25519 AAAA1", "ssh-ed25519 AAAA2"],
			});
			expect(gh.state.asked.sort()).toEqual(["/users/alice", "/users/alice/keys"]);
		}).pipe(Effect.provide(gh.layer(0)));
	});

	it.effect("keeps the id when the login is renamed, and the old login is nobody", () => {
		const gh = fakeGitHub();
		gh.users.set("robert", {id: 8, keys: []});
		return Effect.gen(function* () {
			expect(yield* of("robert")).toEqual({id: "github:8", keys: []});
			expect(yield* of("bob")).toBeNull();
		}).pipe(Effect.provide(gh.layer(0)));
	});

	it.effect("asks nothing for a name that is no GitHub login", () => {
		const gh = fakeGitHub();
		return Effect.gen(function* () {
			for (const name of ["-alice", "a--b", "a/b", "x".repeat(40), "github:7"])
				expect(yield* of(name)).toBeNull();
			expect(gh.state.asked).toEqual([]);
		}).pipe(Effect.provide(gh.layer(0)));
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
			expect(yield* of("alice")).toEqual({id: "github:7", keys: []});
		}).pipe(Effect.provide(gh.layer()));
	});

	it.effect("fails as unreachable on an answer that does not read", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 1.5, keys: []});
		return Effect.gen(function* () {
			const bad = yield* Effect.flip(of("alice"));
			expect(bad._tag).toBe("KeysUnreachable");
		}).pipe(Effect.provide(gh.layer(0)));
	});

	it.effect("asks GitHub once in its cache time, and again after", () => {
		const gh = fakeGitHub();
		gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA1"]});
		return Effect.gen(function* () {
			yield* of("alice");
			gh.users.set("alice", {id: 7, keys: []});
			// Taken off on GitHub, still in the copy here: the old answer, until the copy is old.
			expect((yield* of("alice"))?.keys).toEqual(["ssh-ed25519 AAAA1"]);
			expect(gh.state.asked).toHaveLength(2);
			yield* TestClock.adjust(KEYS_CACHE_MS);
			expect((yield* of("alice"))?.keys).toEqual([]);
			expect(gh.state.asked).toHaveLength(4);
		}).pipe(Effect.provide(gh.layer()));
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
