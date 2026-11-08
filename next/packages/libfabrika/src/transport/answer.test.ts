// p23/p82: answerFrame(text, attachment, admit, route). A failed route stays retryable; a parked
// wait is data. Plants: answer a notification; route before initialize; turn a failure into err.
import {assert, describe, expect, it, vi} from "@effect/vitest";
import {Effect, Schema} from "effect";
import * as T from "./index.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

class Offline extends Schema.TaggedError<Offline>()("Offline", {}) {}
type Route = (
	method: string,
	params: unknown,
	who: typeof T.Who.Type,
) => Effect.Effect<typeof T.Answer.Type, Offline>;
const online = () =>
	T.Attached.cases.online.make({
		client: "c1",
		who: {key: "SHA256:checked", person: PERSON, as: "window"},
		version: 2,
		waits: [],
		watching: false,
		busy: false,
	});
const admit = () => Effect.die("online routing must not repeat hello admission");
const frame = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		jsonrpc: "2.0",
		id: "r1",
		method: "ledger.read",
		params: {stream: "x", after: 0},
		...over,
	});
describe("P10 JSON-RPC", () => {
	it.effect("p23: numeric reply id zero is preserved, not mistaken for a notification", () =>
		Effect.gen(function* () {
			const result = yield* T.answerFrame(frame({id: 0}), online(), admit, () =>
				Effect.succeed(T.Answer.cases.ok.make({result: null})),
			);
			expect(JSON.parse(result.send!)).toEqual({jsonrpc: "2.0", id: 0, result: null});
		}),
	);
	for (const mode of ["ok", "refused"] as const)
		it.effect(`p23: ${mode} has one matching reply`, () =>
			Effect.gen(function* () {
				const answer =
					mode === "ok"
						? T.Answer.cases.ok.make({result: {rows: [1]}})
						: T.Answer.cases.refused.make({why: "stale"});
				const route = vi.fn(() => Effect.succeed(answer));
				const result = yield* T.answerFrame(frame(), online(), admit, route);
				expect(result.send).not.toBeNull();
				const reply = JSON.parse(result.send!);
				expect(reply).toMatchObject({jsonrpc: "2.0", id: "r1"});
				expect(mode === "ok" ? reply.result : reply.error.data).toEqual(
					mode === "ok" ? {rows: [1]} : {why: "stale"},
				);
				expect(route).toHaveBeenCalledOnce();
				assert(result.attached._tag === "online");
				expect(result.attached.waits).toEqual([]);
			}),
		);
	for (const mode of ["failure", "defect"] as const)
		it.effect(`p23: ${mode} sends nothing and permits a real retry`, () =>
			Effect.gen(function* () {
				const attached = online();
				const first =
					mode === "failure" ? Effect.fail(new Offline({})) : Effect.die("route crashed");
				const route = vi
					.fn<Route>()
					.mockReturnValueOnce(first)
					.mockReturnValueOnce(Effect.succeed(T.Answer.cases.ok.make({result: "recovered"})));
				const failed = yield* T.answerFrame(frame(), attached, admit, route);
				expect(failed).toEqual({send: null, attached});
				const retried = yield* T.answerFrame(frame(), failed.attached, admit, route);
				expect(JSON.parse(retried.send!)).toMatchObject({id: "r1", result: "recovered"});
				expect(route).toHaveBeenCalledTimes(2);
			}),
		);
	for (const text of [
		"{",
		"null",
		"[]",
		JSON.stringify({jsonrpc: "2.0", id: "r1", result: 7}),
		JSON.stringify({jsonrpc: "2.0", method: "news", params: {}}),
	])
		it.effect(`p23: no reply for junk, response or notification ${text}`, () =>
			Effect.gen(function* () {
				const route = vi.fn(() => Effect.succeed(T.Answer.cases.ok.make({result: null})));
				expect((yield* T.answerFrame(text, online(), admit, route)).send).toBeNull();
			}),
		);
	for (const state of ["new", "waiting"] as const)
		it.effect(
			`d2: ${state} gets one no_hello reply without reaching an application route (p23)`,
			() =>
				Effect.gen(function* () {
					const attached =
						state === "new"
							? T.Attached.cases.new.make({client: "c1", nonce: "n"})
							: T.Attached.cases.waiting.make({
									client: "c1",
									key: "k",
									nonce: "n",
									hello: {
										versions: [1],
										has: [],
										ping: "30s",
										key: "k",
										tab: "t",
										nonce: "n",
										platform: "headless",
										os: "linux",
										sentAt: "",
										signed: "",
									},
								});
					const route = vi.fn(() => Effect.die("unauthenticated route"));
					// Plant: silently drop a request before the connection is online.
					for (const method of ["ledger.read", "process.send", "unknown.method"])
						for (const id of ["r1", 0]) {
							const result = yield* T.answerFrame(frame({id, method}), attached, admit, route);
							expect(result.send).not.toBeNull();
							expect(JSON.parse(result.send!)).toEqual({
								jsonrpc: "2.0",
								id,
								error: {code: -32000, message: "no_hello", data: {why: "no_hello"}},
							});
							expect(result.attached).toEqual(attached);
						}
					expect(route).not.toHaveBeenCalled();
				}),
		);
	for (const id of ["r1", 0])
		it.effect(`p23: parked wait retains reply id ${id} and cursor, with no unresolved work`, () =>
			Effect.gen(function* () {
				const result = yield* T.answerFrame(frame({id}), online(), admit, () =>
					Effect.succeed(T.Answer.cases.parked.make({stream: "x", after: 8})),
				);
				expect(result.send).toBeNull();
				assert(result.attached._tag === "online");
				expect(result.attached.waits).toEqual([{id, stream: "x", after: 8}]);
				expect(JSON.parse(JSON.stringify(result.attached))).toEqual(result.attached);
			}),
		);
	it.effect("p82: additive request fields leave the reply id and checked writer alone", () =>
		Effect.gen(function* () {
			const route = vi.fn((_method: string, _params: unknown, _who: typeof T.Who.Type) =>
				Effect.succeed(T.Answer.cases.ok.make({result: null})),
			);
			const attached = online();
			const result = yield* T.answerFrame(frame({future: {by: "forged"}}), attached, admit, route);
			expect(JSON.parse(result.send!)).toMatchObject({id: "r1", result: null});
			expect(route.mock.calls[0]?.[2]).toEqual(attached.who);
		}),
	);
});
