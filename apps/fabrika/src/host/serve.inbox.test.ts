import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Ledger, streams} from "@kampus/fabrika-old";
import {layerSqliteSync} from "@kampus/fabrika-old/sqlite";
import {sealAsk} from "@kampus/pipeline/tickets/ask";
import {nameOf} from "@kampus/pipeline/tickets/ticket";
import {pullRequestsOf} from "@tea-fabrika/tracker";
import {Effect, Exit, FileSystem, Layer, Schedule, Scope} from "effect";
import {describe, expect, it} from "vitest";
import {DRAFT, FILED} from "../../../../fixtures/ask-desk/cases.ts";
import {AGENT, OWNER} from "../../../../fixtures/inbox/cases.ts";
import {product} from "../../../../fixtures/inbox/subject.ts";
import {nativeAgent} from "../../e2e/inbox-native.ts";
import type {Down} from "../link.ts";
import {appWire} from "../wire.ts";
import {runHost} from "./run.ts";
import {pathsOf, reach} from "./socket.ts";

const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);
const go = <A, E>(body: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
	Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(platform)));
const until = <A>(what: string, read: () => A | undefined) =>
	Effect.gen(function* () {
		for (let n = 0; n < 200; n++) {
			const value = read();
			if (value !== undefined) return value;
			yield* Effect.sleep("10 millis");
		}
		return yield* Effect.die(`no ${what}`);
	});
const hostOn = (home: string) =>
	Effect.gen(function* () {
		const host = yield* Scope.make();
		yield* Effect.addFinalizer(() => Scope.close(host, Exit.void));
		yield* runHost({home, pid: process.pid}).pipe(Effect.scoped, Effect.forkIn(host));
		const paths = yield* pathsOf(home);
		yield* reach(paths.mcp).pipe(
			Effect.repeat({until: (r) => r === "live", schedule: Schedule.spaced("10 millis")}),
			Effect.timeout("5 seconds"),
		);
		return paths;
	});
const connected = (home: string) =>
	Effect.gen(function* () {
		const paths = yield* hostOn(home);
		const got: Down[] = [];
		const wire = yield* appWire(yield* NodeSocket.makeNet({path: paths.sock}), (m) => got.push(m));
		yield* wire.up;
		wire.send({type: "page"});
		yield* until("desk", () =>
			got.find(
				(m) => m.type === "to" && m.port === "desk" && Reflect.get(Object(m.m), "type") === "desk",
			),
		);
		yield* until("the initial tsh port", () =>
			got.find((m) => m.type === "port" && m.port === "tile:t1"),
		);
		const scout = yield* Effect.acquireRelease(
			Effect.promise(() => nativeAgent(home, "scout")),
			(a) => Effect.promise(() => a.close()).pipe(Effect.ignore),
		);
		return {home, paths, wire, got, scout};
	});
const setup = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const home = yield* fs.makeTempDirectoryScoped({prefix: "ih-"});
	return yield* connected(home);
});
const incoming = {id: "m17", to: "owner", text: "The footer check fails.", ticket: null, said: 17};
const snapshot = (got: readonly Down[]) =>
	got
		.filter((m) => m.type === "to" && m.port === "desk")
		.map((m) => (m.type === "to" ? m.m : null));
const sender = (raw: unknown, id: string): unknown => {
	if (typeof raw !== "object" || raw === null) return undefined;
	if (Reflect.get(raw, "id") === id) return Reflect.get(raw, "by");
	for (const child of Object.values(raw)) {
		const found = sender(child, id);
		if (found !== undefined) return found;
	}
	return undefined;
};

describe("today's inbox across the real native host", () => {
	it("I9: the caller stamps sender identity and receives no person's answer tool", async () => {
		await product(
			"packages/fabrika/src/host/rooms.ts",
			"I9",
			"no caller-bound native DM service exists",
		);
		await go(
			Effect.gen(function* () {
				const {scout} = yield* setup;
				const tools = yield* Effect.promise(() => scout.tools());
				expect(tools, "I9: the native agent has no DM delivery path").toContain("dm_send");
				expect(tools).not.toContain("tracker_answer");
				expect(tools).not.toContain("inbox_answer");
				const valid = yield* Effect.promise(() => scout.call("dm_send", incoming));
				expect(valid.error).toBe(false);
				const forged = yield* Effect.promise(() =>
					scout.call("dm_send", {...incoming, id: "forged", by: OWNER}),
				);
				const read = yield* Effect.promise(() => scout.call("dm_read", {after: 0, limit: 100}));
				expect(read.error).toBe(false);
				expect(sender(JSON.parse(read.text), "m17")).toEqual(AGENT);
				// A strict payload may reject by. If accepted, it still cannot stamp owner.
				expect(sender(JSON.parse(read.text), "forged")).toEqual(forged.error ? undefined : AGENT);
				const answer = yield* Effect.promise(() =>
					scout.call("tracker_answer", {ticket: 268, ask: "a", answer: {_tag: "rec"}}),
				);
				expect(answer.error).toBe(true);
			}),
		);
	});

	it("I10: another agent's DM never appears in caller-scoped reads or forged room reads", async () => {
		await product(
			"packages/fabrika/src/host/rooms.ts",
			"I10",
			"no caller-scoped native DM read exists",
		);
		await go(
			Effect.gen(function* () {
				const {home, scout} = yield* setup;
				expect(
					yield* Effect.promise(() => scout.tools()),
					"I10: the native agent has no scoped DM read",
				).toContain("dm_read");
				const other = yield* Effect.acquireRelease(
					Effect.promise(() => nativeAgent(home, "other")),
					(a) => Effect.promise(() => a.close()).pipe(Effect.ignore),
				);
				const privateText = "only-other-and-owner-should-read-this";
				expect(
					(yield* Effect.promise(() =>
						other.call("dm_send", {...incoming, id: "private", text: privateText}),
					)).error,
				).toBe(false);
				expect((yield* Effect.promise(() => scout.call("dm_send", incoming))).error).toBe(false);
				const own = yield* Effect.promise(() => scout.call("dm_read", {after: 0, limit: 100}));
				expect(own.error).toBe(false);
				expect(own.text).toContain(incoming.text);
				expect(own.text).not.toContain(privateText);
				const forged = yield* Effect.promise(() =>
					scout.call("dm_read", {after: 0, limit: 100, thread: "dm/owner/other"}),
				);
				expect(forged.text).not.toContain(privateText);
			}),
		);
	});

	it("I4: receipt updates inbox data without opening a view or moving desk focus", async () => {
		await product(
			"packages/fabrika/src/host/rooms.ts",
			"I4",
			"no native message receipt feeds an inbox",
		);
		await go(
			Effect.gen(function* () {
				const {scout, got} = yield* setup;
				expect(
					yield* Effect.promise(() => scout.tools()),
					"I4: no unsolicited message route reaches the inbox",
				).toContain("dm_send");
				const before = snapshot(got)
					.filter((m) => Reflect.get(Object(m), "type") === "desk")
					.at(-1);
				const ports = got.filter((m) => m.type === "port");
				expect((yield* Effect.promise(() => scout.call("dm_send", incoming))).error).toBe(false);
				yield* until("inbox receipt", () =>
					snapshot(got).find(
						(m) =>
							Reflect.get(Object(m), "type") === "inbox" &&
							JSON.stringify(m).includes(incoming.text),
					),
				);
				expect(
					snapshot(got)
						.filter((m) => Reflect.get(Object(m), "type") === "desk")
						.at(-1),
				).toEqual(before);
				expect(got.filter((m) => m.type === "port")).toEqual(ports);
				expect(snapshot(got).filter((m) => Reflect.get(Object(m), "type") === "show")).toEqual([]);
			}),
		);
	});

	it("I19: closing every inbox view leaves native receipt running", async () => {
		await product(
			"packages/fabrika/src/host/rooms.ts",
			"I19",
			"no host-owned inbox receives while views are closed",
		);
		await go(
			Effect.gen(function* () {
				const {scout, wire, got} = yield* setup;
				expect(
					yield* Effect.promise(() => scout.tools()),
					"I19: no inbox runtime receives while its views are closed",
				).toContain("dm_send");
				wire.send({
					type: "on",
					port: "desk",
					m: {
						type: "open_program",
						program: "inbox",
						location: {row: null},
						from: "t1",
						via: {_tag: "key", keys: "shift+o"},
					},
				});
				const port = yield* until("inbox tile", () =>
					got.find((m) => m.type === "port" && m.port.startsWith("run:inbox:")),
				);
				wire.send({type: "on", port: "desk", m: {type: "run", does: "tezgah.close"}});
				yield* until("close question", () =>
					snapshot(got).findLast(
						(m) =>
							Reflect.get(Object(m), "type") === "desk" &&
							Reflect.get(Object(Reflect.get(Object(m), "desk")), "ask") != null,
					),
				);
				wire.send({type: "on", port: "desk", m: {type: "press", id: 1, key: "y"}});
				yield* until("inbox view gone", () =>
					got.find((m) => m.type === "gone" && port.type === "port" && m.port === port.port),
				);
				expect((yield* Effect.promise(() => scout.call("dm_send", incoming))).error).toBe(false);
				yield* until("receipt after leave", () =>
					snapshot(got).findLast(
						(m) =>
							Reflect.get(Object(m), "type") === "inbox" &&
							JSON.stringify(m).includes(incoming.text),
					),
				);
			}),
		);
	});

	it("I11: old asks.json marks migrate, and the Dock projection still counts only Your turn", async () => {
		await product(
			"programs/inbox/src/index.ts",
			"I11",
			"no recipient runtime migrates today's saved ask marks",
		);
		await go(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "im-"});
				const ask = yield* sealAsk({...DRAFT, ask: "migrate-268"});
				const key = "268/migrate-268";
				yield* Effect.gen(function* () {
					const ledger = yield* Ledger;
					yield* ledger.register(nameOf(268), "user:owner");
					yield* ledger.send(streams(nameOf(268)).inbox, "file", {
						kind: "filed",
						writer: "user:owner",
						data: FILED,
					});
					yield* ledger.send(streams(nameOf(268)).inbox, "ask", {
						kind: "asked",
						writer: "agent:scout for:owner",
						data: ask,
					});
				}).pipe(Effect.provide(layerSqliteSync({path: `${home}/ledger.sqlite`})), Effect.scoped);
				yield* fs.writeFileString(`${home}/asks.json`, JSON.stringify({later: [key], seen: [key]}));
				const {got, scout} = yield* connected(home);
				const inbox = yield* until("saved marks in inbox", () =>
					snapshot(got).findLast(
						(m) => Reflect.get(Object(m), "type") === "inbox" && JSON.stringify(m).includes(key),
					),
				);
				expect(inbox).toMatchObject({now: {marks: {later: [key], seen: [key]}}});
				expect((yield* Effect.promise(() => scout.call("dm_send", incoming))).error).toBe(false);
				yield* until("message received", () =>
					snapshot(got).findLast(
						(m) =>
							Reflect.get(Object(m), "type") === "inbox" &&
							JSON.stringify(m).includes(incoming.text),
					),
				);
				const badge = snapshot(got).findLast((m) => Reflect.get(Object(m), "type") === "asks");
				expect(badge).toMatchObject({
					now: {asks: [], later: [expect.objectContaining({key, seen: true})]},
				});
			}),
		);
	});
});
