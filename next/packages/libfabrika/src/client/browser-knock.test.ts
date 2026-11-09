// P23, next/. A Socket supplies frames and replies, never connection policy.
import {describe, expect, expectTypeOf, it} from "@effect/vitest";
import type {Redacted} from "effect";
import {Effect, Fiber, Option, Queue, Schema} from "effect";
import {Socket} from "effect/socket";
import {IdGenerator} from "../data/id.ts";
import {Bytes32, checks, leaks, Operations} from "../desktop/browser-link.test-support.ts";
import type {ClientConnection} from "./connection.ts";

const socketPath = "./socket.ts",
	connectionPath = "./connection.ts",
	browserPath = "../browser/link.ts";
const load = () => Effect.promise((): Promise<typeof import("./socket.ts")> => import(socketPath));
const typeLaw = (
	connection: (typeof ClientConnection)["Service"],
	pass: Redacted.Redacted<string>,
) => {
	// @ts-expect-error a secret can travel only through the narrow knock method
	const invalid = connection.request("door.knock", {label: "Browser", pass});
	const valid = connection.knock({label: "Browser", pass: Option.some(pass)});
	expectTypeOf(valid).toExtend<Effect.Effect<Schema.Json, unknown>>();
	return [invalid, valid];
};
void typeLaw;

const socketFixture = Effect.fnUntraced(function* () {
	const received = yield* Queue.unbounded<string>();
	const sent = yield* Queue.unbounded<string>();
	const frames: string[] = [];
	const write = (frame: string | Uint8Array | Socket.CloseEvent) =>
		Effect.gen(function* () {
			if (Socket.isCloseEvent(frame)) return;
			const text = typeof frame === "string" ? frame : new TextDecoder().decode(frame);
			frames.push(text);
			yield* Queue.offer(sent, text);
		});
	const socket = Socket.make({
		reader: Effect.succeed({
			pull: Queue.take(received).pipe(Effect.map((frame) => [frame])),
			upgrade: () => Effect.void,
		}),
		writer: Effect.succeed({
			write,
			writeAll: (chunks) => Effect.forEach(chunks, write, {discard: true, concurrency: 1}),
		}),
	});
	const reply = Effect.gen(function* () {
		const text = yield* Queue.take(sent);
		const request = JSON.parse(text);
		yield* Queue.offer(
			received,
			JSON.stringify({jsonrpc: "2.0", id: request.id, result: {code: "123456", until: 60000}}),
		);
		return request;
	});
	return {socket, frames, reply, next: Queue.take(sent)};
});

describe("P23 narrow browser knock", () => {
	it.effect.prop(
		"[secrets] take, knock, interruption and reconnect send at most one secret-bearing frame",
		{bytes: Bytes32, ops: Operations, interrupt: Schema.Boolean},
		({bytes, ops, interrupt}) =>
			Effect.gen(function* () {
				const {socketConnection} = yield* load();
				const {ClientConnection}: typeof import("./connection.ts") = yield* Effect.promise(
					() => import(connectionPath),
				);
				const {BrowserPass}: typeof import("../browser/link.ts") = yield* Effect.promise(
					() => import(browserPath),
				);
				const raw = Buffer.from(bytes).toString("base64url");
				let hash = `#pass=${raw}`;
				const fixture = yield* socketFixture();
				yield* Effect.gen(function* () {
					const connection = yield* ClientConnection;
					const holder = yield* BrowserPass;
					yield* holder.ready;
					expect(hash).toBe("");
					yield* connection.open(1);
					const pass = yield* holder.take;
					const fiber = yield* Effect.forkChild(connection.knock({label: "Browser", pass}));
					if (interrupt) {
						const frame = yield* fixture.next;
						expect(JSON.parse(frame)).toMatchObject({method: "door.knock", params: {pass: raw}});
						yield* Fiber.interrupt(fiber);
					} else {
						expect(yield* fixture.reply).toMatchObject({
							method: "door.knock",
							params: {label: "Browser", pass: raw},
						});
						expect(yield* Fiber.join(fiber)).toMatchObject({code: "123456"});
					}
					let dial = 1;
					for (const op of ["knock", ...ops]) {
						if (op === "interrupt") {
							yield* connection.close;
							yield* connection.open(++dial);
						}
						if (op !== "knock" && op !== "take") continue;
						const nextPass = yield* holder.take;
						expect(Option.isNone(nextPass)).toBe(true);
						const next = yield* Effect.forkChild(
							connection.knock({label: "Browser", pass: nextPass}),
						);
						expect(leaks(raw, yield* fixture.reply)).toBe(false);
						yield* Fiber.join(next);
					}
				}).pipe(
					Effect.provide(socketConnection(fixture.socket)),
					Effect.provide(IdGenerator.layer),
					Effect.provide(
						BrowserPass.browser({
							hash: () => hash,
							clear: () => {
								hash = "";
							},
						}),
					),
				);
				expect(fixture.frames.filter((frame) => leaks(raw, frame))).toHaveLength(1);
				for (const frame of fixture.frames) {
					const request = JSON.parse(frame);
					const {pass: _pass, ...params} = request.params;
					expect(leaks(raw, {...request, params})).toBe(false);
				}
			}),
		checks,
	);
	it.effect.prop(
		"a pass on an already waiting key updates its digest without changing code or duplicating rows",
		{
			bytes: Bytes32,
			clients: Schema.Array(Schema.NonEmptyString).check(Schema.isBetweenLength(1, 20)),
			code: Schema.String,
		},
		({bytes, clients, code}) =>
			Effect.gen(function* () {
				const waitingPath = "../transport/waiting.ts",
					doorPath = "../server/door.ts",
					passPath = "../transport/browser-pass.ts";
				// The relocated door must exist too. This cannot silently exercise today's old pass storage.
				const door: typeof import("../server/door.ts") = yield* Effect.promise(
					() => import(doorPath),
				);
				expect(door.Door).toBeDefined();
				const {Waiting}: typeof import("../transport/waiting.ts") = yield* Effect.promise(
					() => import(waitingPath),
				);
				const {PassSecret, passDigest}: typeof import("../transport/browser-pass.ts") =
					yield* Effect.promise(() => import(passPath));
				const {Digest} = yield* Effect.promise(() => import("effect/crypto"));
				const raw = Buffer.from(bytes).toString("base64url");
				const pass = yield* Schema.decodeUnknownEffect(PassSecret)(raw);
				const digest = yield* passDigest(pass).pipe(Effect.provide(Digest.layerWebCrypto));
				let state = yield* Waiting.makeEffect({rows: [], most: 20, ttl: 120000});
				for (const [n, client] of clients.entries())
					state = Waiting.knock(state, {
						key: "same-key",
						label: "Tab",
						where: "local",
						has: [],
						as: "window",
						code: n === 0 ? code : "new-code-ignored",
						client,
						at: n,
						digest: null,
					});
				const before = state.rows[0]!;
				state = Waiting.knock(state, {
					...before,
					client: clients[0]!,
					at: clients.length + 1,
					code: "ignored",
					digest,
				});
				expect(state.rows).toHaveLength(1);
				expect(state.rows[0]).toMatchObject({
					key: "same-key",
					code,
					digest,
					tabs: new Set(clients).size,
				});
				expect(leaks(raw, state)).toBe(false);
			}),
		checks,
	);
});
