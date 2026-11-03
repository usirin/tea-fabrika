import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {keyFileText, keyLineOf, memoryStorage, offer, start, viewOf} from "@kampus/fabrika-old";
import {startTwin} from "@kampus/ledger-server/twin";
import {pullRequestsOf, type Shown, tracker} from "@tea-fabrika/tracker";
import {Effect, Exit, type FileSystem, Layer, Option, type Path, Scope, Stream} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {connect, hostLedger, invite} from "./connection.ts";
import {AGENT_KEY, post} from "./post.ts";

// An agent posts to the tracker for its person, on a ledger server's twin (as shared.test.ts):
// alice founds it and invites bob; bob's agent `triage` files a ticket and comments on it. The
// ledger says each write is agent:triage, for bob, whatever the agent says it is.

const users = new Map<string, {id: number; keys: string[]}>();
const fakeGitHub = async (req: Request): Promise<Response> => {
	const url = new URL(req.url);
	if (url.host !== "api.github.com") return new Response("not here", {status: 502});
	const byId = /^\/user\/([0-9]+)$/.exec(url.pathname);
	if (byId !== null) {
		const found = [...users].find(([, u]) => u.id === Number(byId[1]));
		return found === undefined
			? Response.json({message: "Not Found"}, {status: 404})
			: Response.json({id: found[1].id, login: found[0]});
	}
	const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
	const u = m?.[1] === undefined ? undefined : users.get(decodeURIComponent(m[1]));
	if (u === undefined) return Response.json({message: "Not Found"}, {status: 404});
	return m?.[2] === undefined
		? Response.json({id: u.id, login: m?.[1]})
		: Response.json(u.keys.map((key, i) => ({id: i + 1, key})));
};

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
let root = "";
let address = "";
const twinScope = Effect.runSync(Scope.make());
const person = (name: string) => ({home: join(root, name, "home"), key: join(root, name, "key")});

const keyFor = async (login: string, id: number) => {
	const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	writeFileSync(person(login).key, await keyFileText(pair, `${login}@laptop`), {mode: 0o600});
	const line = keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
	users.set(login, {id, keys: [line]});
};

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "fabrika-post-"));
	for (const name of ["alice", "bob"]) mkdirSync(join(root, name, "home"), {recursive: true});
	await keyFor("alice", 7);
	await keyFor("bob", 8);
	const twin = await Effect.runPromise(
		startTwin({
			config: {name: "acme-ledger", founder: "github:7"},
			persist: false,
			github: fakeGitHub,
			cacheMs: 0,
		}).pipe(Scope.provide(twinScope)),
	);
	address = `${twin.url}/acme`;
});

afterAll(async () => {
	await Effect.runPromise(Scope.close(twinScope, Exit.void));
	rmSync(root, {recursive: true, force: true});
});

const run = <A, E>(e: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(platform)));

/** Ticket `n`'s timeline as alice's host reads it: who wrote each fact, and its type. */
const timelineAt = (home: string, n: number) =>
	run(
		Effect.gen(function* () {
			const services = yield* Layer.build(Layer.merge(hostLedger(home), pullRequestsOf([])));
			const started = yield* start(tracker, {}, {}, {id: "read", storage: memoryStorage()}).pipe(
				Effect.provideContext(services),
			);
			if (started.kind !== "running") return yield* Effect.die("the tracker did not start");
			const view = viewOf(tracker);
			if (view === undefined) return yield* Effect.die("the tracker has no view");
			yield* offer(started.run, "query", {ticket: n});
			const shown = yield* started.run.machines.tickets.changes.pipe(
				Stream.filter((s) => s !== null),
				Stream.map((s) => view.of(s) as Shown),
				Stream.filter((s) => s.page.kind === "ticket" && s.page.opened !== null),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);
			yield* offer(started.run, "quit", null);
			return shown.page.kind === "ticket"
				? (shown.page.opened?.ticket.timeline.map((e) => [e.by, e.fact.type]) ?? [])
				: [];
		}),
	);

describe("an agent posts for its person", () => {
	it("as agent:<name> for that person, with a key made once and kept", async () => {
		const alice = person("alice");
		const bob = person("bob");
		await run(connect(alice.home, {address, login: "alice", key: alice.key}));
		await run(invite(alice.home, "bob"));
		await run(connect(bob.home, {address, login: "bob", key: bob.key}));

		const filed = await run(
			post(bob.home, "triage", [{type: "file", value: {title: "A bug", body: "It breaks."}}]),
		);
		expect(filed).toEqual(["#1 open c0 A bug"]);
		const key = join(bob.home, AGENT_KEY);
		expect(statSync(key).mode & 0o777).toBe(0o600);
		const made = readFileSync(key, "utf8");

		const commented = await run(
			post(bob.home, "triage", [{type: "comment", value: {ticket: 1, body: "Seen it."}}]),
		);
		expect(commented).toEqual(["#1 open c1 A bug"]);
		expect(readFileSync(key, "utf8")).toBe(made);

		const agent = {kind: "agent", id: "triage", for: "github:8"};
		expect(await timelineAt(alice.home, 1)).toEqual([
			[agent, "filed"],
			[agent, "commented"],
		]);
	});

	it("refuses a name that is no agent's, and a home with no server, before any key is made", async () => {
		const bad = await run(post(person("bob").home, "Not An Agent", []).pipe(Effect.flip));
		expect(bad).toMatchObject({_tag: "ConnectFailed"});
		const lone = join(root, "lone");
		mkdirSync(lone);
		const none = await run(post(lone, "triage", []).pipe(Effect.flip));
		expect(none).toMatchObject({_tag: "ConnectFailed", why: expect.stringContaining("connect")});
		expect(() => statSync(join(lone, AGENT_KEY))).toThrow();
	});
});
