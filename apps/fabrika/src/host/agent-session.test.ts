import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {keyFileText, keyLineOf, Ledger, PERSON_KINDS} from "@kampus/fabrika-old";
import {startTwin} from "@kampus/ledger-server/twin";
import {Author} from "@tea-fabrika/tracker";
import {Context, Effect, Exit, type FileSystem, Layer, Logger, type Path, Scope} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {agentLedger} from "./agent-session.ts";
import {addressOf, connect, hostLedger, keepConnection} from "./connection.ts";

// An agent's own session on the home's ledger server (tracker 185, PR 185a). Today's version.
// `agentLedger(home, name)` is what `fabrika post` did for one post, kept for as long as the
// agent stays: the home's one agent key (`<home>/agent_ed25519`, made once), a grant for that
// name signed with the person's key file, the agent's login with its own key, and the session
// renewed before its end with the same `renewing` the person's session uses.
//
//   const services = yield* Layer.build(agentLedger(home, "claude"));
//   Context.get(services, Author)    {kind: "agent", id: "claude", for: "github:7"}
//   ledger.append("t/inbox", "any", {kind: "note", writer: "user:github:7", data})
//   // the row says agent:claude for:github:7: the door stamps the session's writer, never the
//   // request's, so an agent's session can never write as the person
//   host/log   message=agent_session agent=claude expires=1767225600000
//
// The server is its twin in Miniflare (packages/ledger-server), as post.test.ts and
// shared.test.ts run it; GitHub is a fake that lists alice's key. No call leaves the laptop, and
// every key is made here, at test time.

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
/** alice's key file: the one `ledger.json` names. */
const aliceKey = () => join(root, "alice.key");
/** A fresh home for each test, so each makes its own agent key. */
let homes = 0;

const freshHome = () => {
	homes += 1;
	const home = join(root, `h${homes}`);
	mkdirSync(home, {recursive: true});
	return home;
};

const AGENT_KEY = "agent_ed25519";
const ALICE = "github:7";
const CLAUDE = {kind: "agent", id: "claude", for: ALICE} as const;

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "se-"));
	const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	writeFileSync(aliceKey(), await keyFileText(pair, "alice@laptop"), {mode: 0o600});
	const line = keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
	users.set("alice", {id: 7, keys: [line]});
	const twin = await Effect.runPromise(
		startTwin({
			config: {name: "acme-ledger", founder: ALICE},
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

/** Run `e` on the laptop's file system, its log lines caught in `lines` as host/log holds them. */
const run = <A, E>(
	e: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
	lines: string[] = [],
) =>
	Effect.runPromise(
		e.pipe(
			Effect.scoped,
			Effect.provide(platform),
			Effect.provide(
				Logger.layer([Logger.make((o) => void lines.push(Logger.formatSimple.log(o)))]),
			),
		),
	);

/** One log line's `key=value` fields, as `Logger.formatSimple` writes them, quotes taken off. */
const fieldsOf = (line: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const m of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
		const [, key = "", raw = ""] = m;
		out[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
	}
	return out;
};

const said = (lines: readonly string[], message: string) =>
	lines.map(fieldsOf).filter((f) => f.message === message);

/**
 * The agent's services on `home`: who it writes as, its ledger, and `note`, one fact appended to
 * the inbox of the registered name `box`, saying it is written by `writer`.
 */
const asAgent = (home: string, name: string) =>
	Effect.gen(function* () {
		const services = yield* Layer.build(agentLedger(home, name));
		const ledger = Context.get(services, Ledger);
		const note = (box: string, kind: string, writer: string, data: unknown = {}) =>
			ledger.append(`${box}/inbox`, "any", {kind, writer, data});
		/** Register `box`, so its inbox takes facts. */
		const open = (box: string) => ledger.register(box, "x");
		return {author: Context.get(services, Author), ledger, note, open};
	});

/** The rows of the inbox of `box`, read through the person's own session. */
const rowsOf = (home: string, box: string) =>
	Effect.gen(function* () {
		const services = yield* Layer.build(hostLedger(home));
		return yield* Context.get(services, Ledger).readStream(`${box}/inbox`);
	});

const connectAlice = (home: string) =>
	connect(home, {address, login: "alice", key: aliceKey()}).pipe(Effect.asVoid);

// First in the file, on purpose: the twin is fresh, so alice has no session on it yet.
describe("an agent's login while its person has no session", () => {
	it("is refused 403 by the door, so the person logs in, then the agent", async () => {
		const home = freshHome();
		const lines: string[] = [];
		const seen = await run(
			Effect.gen(function* () {
				// Connected by hand, with no login: what a host finds after its person's session ended.
				const {url, ledger} = yield* addressOf(address);
				yield* keepConnection(home, {url, ledger, login: "alice", key: aliceKey()});
				const agent = yield* asAgent(home, "claude");
				yield* agent.open("first");
				yield* agent.note("first", "note", "agent:claude");
				return {author: agent.author, rows: yield* rowsOf(home, "first")};
			}),
			lines,
		);
		expect(seen.author).toEqual(CLAUDE);
		expect(seen.rows.map((r) => r.writer)).toEqual(["agent:claude for:github:7"]);
		expect(said(lines, "agent_session")).toHaveLength(1);
	});
});

describe("an agent's session on a connected home", () => {
	it("writes as the agent for the person, with one agent key made once and kept", async () => {
		const home = freshHome();
		const lines: string[] = [];
		const before = Date.now();
		const first = await run(
			Effect.gen(function* () {
				yield* connectAlice(home);
				const agent = yield* asAgent(home, "claude");
				yield* agent.open("one");
				yield* agent.note("one", "note", "agent:claude");
				return {author: agent.author, rows: yield* rowsOf(home, "one")};
			}),
			lines,
		);
		expect(first.author).toEqual(CLAUDE);
		expect(first.rows.map((r) => r.writer)).toEqual(["agent:claude for:github:7"]);
		const key = join(home, AGENT_KEY);
		expect(statSync(key).mode & 0o777).toBe(0o600);
		const made = readFileSync(key, "utf8");
		// The agent's key is the agent's, never the person's.
		expect(made).not.toBe(readFileSync(aliceKey(), "utf8"));

		// A second session, as a host started again makes one: the same key, not a new one.
		await run(asAgent(home, "claude"));
		expect(readFileSync(key, "utf8")).toBe(made);

		// host/log says the session, its agent and its end: an hour's grant at most.
		const session = said(lines, "agent_session");
		expect(session).toHaveLength(1);
		expect(session[0]).toMatchObject({level: "INFO", agent: "claude"});
		const expires = Number(session[0]?.expires);
		expect(expires).toBeGreaterThan(before);
		expect(expires).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
	});

	it("gives each agent name its own session, under its own name, on the one key", async () => {
		const home = freshHome();
		const seen = await run(
			Effect.gen(function* () {
				yield* connectAlice(home);
				const claude = yield* asAgent(home, "claude");
				const lead = yield* asAgent(home, "lead");
				yield* claude.open("two");
				yield* claude.note("two", "note", "x");
				yield* lead.note("two", "note", "x");
				return {
					authors: [claude.author, lead.author],
					rows: yield* rowsOf(home, "two"),
				};
			}),
		);
		expect(seen.authors).toEqual([CLAUDE, {kind: "agent", id: "lead", for: ALICE}]);
		expect(seen.rows.map((r) => r.writer)).toEqual([
			"agent:claude for:github:7",
			"agent:lead for:github:7",
		]);
	});

	it("is renewed before its end, with no prompt: one more session, ahead of the first's end", async () => {
		const home = freshHome();
		const lines: string[] = [];
		await run(connectAlice(home));
		const seen = await run(
			Effect.gen(function* () {
				// The test's clock starts at the laptop's, so the door's ends and the timer's agree.
				yield* TestClock.setTime(Date.now());
				yield* asAgent(home, "claude");
				const first = said(lines, "agent_session")[0];
				const end = Number(first?.expires);
				// Ten minutes before its end, it has not been renewed yet: no login every minute.
				yield* TestClock.adjust(Math.max(0, end - Date.now() - 10 * 60_000));
				yield* TestClock.withLive(Effect.sleep("300 millis"));
				const early = said(lines, "agent_session").length;
				// One millisecond before its end, a new session has been made.
				yield* TestClock.adjust(10 * 60_000 - 1);
				for (let i = 0; i < 100 && said(lines, "agent_session").length < 2; i += 1)
					yield* TestClock.withLive(Effect.sleep("50 millis"));
				return {end, early, sessions: said(lines, "agent_session")};
			}).pipe(Effect.provide(TestClock.layer())),
			lines,
		);
		expect(seen.early).toBe(1);
		expect(seen.sessions.length).toBeGreaterThanOrEqual(2);
		expect(Number(seen.sessions[1]?.expires)).toBeGreaterThan(seen.end);
	});

	it("is not made on a home with no server, nor for a name that is no agent's", async () => {
		const lone = freshHome();
		const none = await run(asAgent(lone, "claude").pipe(Effect.flip));
		expect(none).toMatchObject({_tag: "ConnectFailed", why: expect.stringContaining("connect")});
		// No key is made for a home that has no server to show it to.
		expect(() => statSync(join(lone, AGENT_KEY))).toThrow();

		const home = freshHome();
		await run(connectAlice(home));
		const bad = await run(asAgent(home, "Not An Agent").pipe(Effect.flip));
		expect(bad).toMatchObject({_tag: "ConnectFailed"});
	});

	it("fails with why when the agent's key cannot be read, and never falls back to the person", async () => {
		const home = freshHome();
		await run(connectAlice(home));
		writeFileSync(join(home, AGENT_KEY), "not a key\n", {mode: 0o600});
		const failed = await run(asAgent(home, "claude").pipe(Effect.flip));
		expect(failed).toMatchObject({_tag: "ConnectFailed", why: expect.stringContaining(AGENT_KEY)});
	});
});

// ---------------------------------------------------------------- the person-only rule

/** Kinds any writer may write: a note, a ticket's facts, an ask put to the person. */
const anyonesKind = fc.constantFrom("note", "filed", "commented", "closed", "ruling_needed");

/** What a request may say it is: the person, another person, another agent, or nonsense. */
const claimed = fc.constantFrom(
	"user:github:7",
	"user:owner",
	"user:github:8",
	"agent:lead for:github:7",
	"agent:claude",
	"ledger",
	"",
);

describe("the person-only rule on an agent's session", () => {
	it("law: whatever writer a write names, the row is the agent's for the person, never the person's", async () => {
		const home = freshHome();
		const seen = await run(
			Effect.gen(function* () {
				yield* connectAlice(home);
				const agent = yield* asAgent(home, "claude");
				const services = yield* Layer.build(hostLedger(home));
				const person = Context.get(services, Ledger);
				yield* agent.open("law");
				let i = 0;
				const failures: string[] = [];
				yield* Effect.promise(() =>
					fc.assert(
						fc.asyncProperty(anyonesKind, claimed, async (kind, writer) => {
							i += 1;
							const rows = await Effect.runPromise(
								agent
									.note("law", kind, writer, {i})
									.pipe(Effect.andThen(person.readStream("law/inbox"))),
							);
							const last = rows.at(-1);
							if (rows.length !== i || last?.writer !== "agent:claude for:github:7")
								failures.push(`${kind} as ${writer}: ${last?.writer}`);
							return failures.length === 0;
						}),
						{numRuns: 20, seed: 119120},
					),
				);
				// Every row the agent's session wrote, read back: none is the person's.
				const all = yield* person.readStream("law/inbox");
				return {failures, writers: [...new Set(all.map((r) => r.writer))]};
			}),
		);
		expect(seen.failures).toEqual([]);
		expect(seen.writers).toEqual(["agent:claude for:github:7"]);
	});

	it("refuses a person's answer from the agent's session with the door's 403, and writes nothing", async () => {
		const home = freshHome();
		const seen = await run(
			Effect.gen(function* () {
				yield* connectAlice(home);
				const agent = yield* asAgent(home, "claude");
				const out: {kind: string; refused: string; rows: number}[] = [];
				for (const kind of PERSON_KINDS) {
					const box = `ask.${kind}`;
					yield* agent.open(box);
					const exit = yield* agent
						.note(box, kind, "user:github:7", {ask: "a-1", pick: "approve", note: ""})
						.pipe(Effect.exit);
					const rows = yield* rowsOf(home, box);
					out.push({
						kind,
						refused: Exit.isFailure(exit) ? String(exit.cause) : "",
						rows: rows.length,
					});
				}
				return out;
			}),
		);
		// Areas PR 1: the three area facts are a person's too (docs/direction/areas.md).
		expect(seen.map((s) => s.kind)).toEqual([
			"answered",
			"duplicate_rated",
			"area_made",
			"area_renamed",
			"area_merged",
		]);
		for (const s of seen) {
			expect(s.refused).toContain("403");
			expect(s.refused).toContain(`only a person writes ${s.kind}`);
			expect(s.rows).toBe(0);
		}
	});
});
