// P25, next/. Scripted outside runs require the real local stage and MCP process.
import {expect, it} from "@effect/vitest";
import {Id} from "@kampus/libfabrika";
import {Effect, Schema} from "effect";
import {startMcpStage} from "./mcp.test-support.ts";

const wording = (reply: unknown) => JSON.stringify(reply);
const waiting = (reply: unknown, letters: ReadonlyArray<unknown>) => {
	expect(reply).toMatchObject({isError: true});
	expect(wording(reply)).toMatch(
		/Waiting for the owner\. Look for code \d[\d ]+ in the fabrika menu bar\./,
	);
	expect(letters).toEqual([]);
};
const reused = (
	before: ReadonlyArray<{readonly id: string; readonly parent?: string | null}>,
	after: ReadonlyArray<{readonly id: string; readonly parent?: string | null}>,
) => {
	expect(before).toHaveLength(1);
	expect(after).toEqual(before);
	expect(Schema.is(Id.Letter)(before[0]?.id)).toBe(true);
	expect(Schema.is(Id.Input)(before[0]?.parent)).toBe(true);
	expect(before[0]?.parent).not.toBe(before[0]?.id);
};
it.live("scenario: L08 waiting calls include the comparison code and append no letter", () =>
	// The full wire path, ledger and approval require one real outside run.
	Effect.gen(function* () {
		const s = yield* startMcpStage();
		const c = yield* s.connect("test-a");
		const tools = yield* Effect.promise(() => c.listTools());
		expect(tools.tools.map((t) => t.name)).toEqual([
			"ps",
			"notes_save",
			"notes_read",
			"notes_list",
		]);
		waiting(
			yield* Effect.promise(() =>
				c.callTool({
					name: "notes_save",
					arguments: {value: {note: "note_0000000000e008000000000000", base: 0, body: "from MCP"}},
				}),
			),
			yield* s.entries,
		);
		yield* s.approve("test-a");
		expect(
			yield* Effect.promise(() =>
				c.callTool({
					name: "notes_save",
					arguments: {value: {note: "note_0000000000e008000000000000", base: 0, body: "from MCP"}},
				}),
			),
		).not.toMatchObject({isError: true});
	}).pipe(Effect.provide(Id.Generator.layer)),
);
it.live("scenario: L09 same name reuses one grant after a bridge process restart", () =>
	// Stopping the real bridge and reopening the same home proves durable identity reuse.
	Effect.gen(function* () {
		const s = yield* startMcpStage();
		yield* s.connect("same");
		yield* s.approve("same");
		const before = yield* s.rows();
		const c = yield* s.restartBridge("same");
		expect(yield* Effect.promise(() => c.callTool({name: "ps", arguments: {}}))).not.toMatchObject({
			isError: true,
		});
		expect(yield* s.rows()).toEqual(before);
		expect((yield* s.membership).filter((r) => r._tag === "granted")).toHaveLength(1);
	}).pipe(Effect.provide(Id.Generator.layer)),
);
it.live("scenario: L11 a second name gets its own real P21 approval row", () =>
	// Key-to-menu integration must use the actual stage and P21 view.
	Effect.gen(function* () {
		const s = yield* startMcpStage();
		yield* s.connect("first");
		yield* s.connect("second");
		const rows = yield* s.rows();
		expect(rows.map((r: {readonly label: string}) => r.label).sort()).toEqual(["first", "second"]);
		expect(new Set(rows.map((r: {readonly key: string}) => r.key)).size).toBe(2);
		expect((yield* s.menuItems).length).toBeGreaterThanOrEqual(2);
		yield* s.approve("first");
		const second = yield* s.connect("second");
		waiting(
			yield* Effect.promise(() => second.callTool({name: "ps", arguments: {}})),
			yield* s.entries,
		);
	}).pipe(Effect.provide(Id.Generator.layer)),
);
it.live("scenario: L14 a save with a lost reply reuses its first letter after restart", () =>
	// Durable restart behavior cannot be proved by a memory-only receipt fixture.
	Effect.gen(function* () {
		const s = yield* startMcpStage();
		yield* s.connect("retry");
		yield* s.approve("retry");
		const args = {
			name: "notes_save",
			arguments: {value: {note: "note_0000000000e008000000000000", base: 0, body: "kept"}},
		};
		yield* s.loseReply("retry", args);
		const before = yield* s.entries;
		const next = yield* s.restartBridge("retry");
		const reply = yield* Effect.promise(() => next.callTool(args));
		expect(reply).not.toMatchObject({isError: true});
		reused(before, yield* s.entries);
	}).pipe(Effect.provide(Id.Generator.layer)),
);
it.live("scenario: L23 Remove blocks active calls, saved answers and reconnect", () =>
	// Ordered cross-client changes need real signed P21 Remove and the real store.
	Effect.gen(function* () {
		const s = yield* startMcpStage();
		const c = yield* s.connect("removed");
		yield* s.approve("removed");
		const args = {
			name: "notes_save",
			arguments: {value: {note: "note_0000000000e008000000000000", base: 0, body: "kept"}},
		};
		yield* Effect.promise(() => c.callTool(args));
		const before = yield* s.entries;
		yield* s.remove("removed");
		expect(yield* Effect.promise(() => c.callTool(args))).toMatchObject({isError: true});
		const next = yield* s.restartBridge("removed");
		expect(yield* Effect.promise(() => next.callTool(args))).toMatchObject({isError: true});
		expect(yield* s.entries).toEqual(before);
	}).pipe(Effect.provide(Id.Generator.layer)),
);
it("plant L08: queue an unapproved save", () =>
	expect(() =>
		waiting(
			{
				isError: true,
				content: [
					{
						type: "text",
						text: "Waiting for the owner. Look for code 482 109 in the fabrika menu bar.",
					},
				],
			},
			[1],
		),
	).toThrow());
it("plant L09: key replaced on restart loses admission", () =>
	expect(() => expect({isError: true}).not.toMatchObject({isError: true})).toThrow());
it("plant L11: home-only identity merges both rows", () =>
	expect(() => expect(new Set(["same", "same"]).size).toBe(2)).toThrow());
it("plant L14: fresh UUID after restart appends twice", () =>
	expect(() => reused([{id: "a"}], [{id: "a"}, {id: "b"}])).toThrow());
it("plant L23: cached receipt bypasses revoked membership", () =>
	expect(() =>
		expect({content: [{type: "text", text: "saved"}]}).toMatchObject({isError: true}),
	).toThrow());
