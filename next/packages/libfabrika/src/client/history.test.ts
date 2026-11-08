// T293, next/. Paging uses raw ledger positions even when a page contains other notes only.
import {Effect, Result, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {Entry, PAGE} from "../data/log.ts";

const options = {seed: 119120, numRuns: 40};
describe("P20 authenticated history paging", () => {
	it("L23 full raw pages permit More; short pages stop and preserve every entry", async () => {
		const {readHistory, HistoryPage} = await import("./history.ts");
		const {ClientConnection} = await import("./connection.ts");
		fc.assert(
			fc.property(
				fc.integer({min: 0, max: 10000}),
				fc.integer({min: 0, max: PAGE - 1}),
				(after, short) => {
					const requests: Array<{method: string; params: Schema.Json}> = [];
					const rows = (length: number, start: number) =>
						Array.from({length}, (_, i) =>
							Schema.decodeUnknownSync(Entry)({
								id: `input_0000000000e008000000000001`,
								stream: "notes:1/inbox",
								pos: start + i + 1,
								rev: start + i + 1,
								arrivedAt: i,
								by: "writer-test",
								for: "person-test",
								sentAt: "2026-11-08T00:00:00Z",
								seen: 0,
								parent: null,
								traceId: "10000000000000000000000000000001",
								build: "test",
								_tag: "send",
								body: {m: {type: "save", value: {note: "other", base: i, body: "other note"}}},
							}),
						);
					const full = rows(PAGE, after),
						last = rows(short, after + PAGE);
					const service = {
						request: (method: string, params: Schema.Json) =>
							Effect.sync(() => {
								requests.push({method, params});
								return {entries: requests.length === 1 ? full : last};
							}),
						news: Stream.empty,
						close: Effect.void,
						events: Stream.empty,
						open: () => Effect.void,
						ping: () => Effect.void,
					};
					const first = Effect.runSync(
						readHistory("notes:1", after).pipe(Effect.provideService(ClientConnection, service)),
					);
					expect(first).toEqual({entries: full, after: after + PAGE, more: true});
					const second = Effect.runSync(
						readHistory("notes:1", first.after).pipe(
							Effect.provideService(ClientConnection, service),
						),
					);
					expect(second).toEqual({entries: last, after: after + PAGE + short, more: false});
					expect(requests).toEqual([
						{method: "ledger.read", params: {stream: "notes:1/inbox", after}},
						{method: "ledger.read", params: {stream: "notes:1/inbox", after: after + PAGE}},
					]);
					expect(Schema.decodeUnknownSync(HistoryPage)(first)).toEqual(first);
					expect(() => expect({...first, after}).toEqual(first)).toThrow();
				},
			),
			options,
		);
	});
	it("L23 malformed read responses fail through ClientDown; never an empty success", async () => {
		const {readHistory} = await import("./history.ts");
		const {ClientConnection, ClientDown} = await import("./connection.ts");
		fc.assert(
			fc.property(fc.jsonValue(), (raw) => {
				const service = {
					request: () => Effect.succeed({entries: [{invalid: raw}]}),
					news: Stream.empty,
					close: Effect.void,
					open: () => Effect.void,
					ping: () => Effect.void,
					events: Stream.empty,
				};
				const result = Effect.runSync(
					Effect.result(
						readHistory("notes:1", 0).pipe(Effect.provideService(ClientConnection, service)),
					),
				);
				expect(Result.isFailure(result)).toBe(true);
				const failed = {...service, request: () => Effect.fail(new ClientDown({why: "closed"}))};
				expect(
					Result.isFailure(
						Effect.runSync(
							Effect.result(
								readHistory("notes:1", 0).pipe(Effect.provideService(ClientConnection, failed)),
							),
						),
					),
				).toBe(true);
				expect(() =>
					expect(Result.succeed({entries: [], after: 0, more: false})).toEqual(result),
				).toThrow();
			}),
			options,
		);
	});
});
