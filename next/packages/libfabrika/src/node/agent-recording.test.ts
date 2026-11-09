// P25 G, next/. Reopen the actual P37 SQLite tables; a memory tracer cannot pass.
import {mkdtempSync, readdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {NodeFileSystem} from "@effect/platform-node";
import {expect, it} from "@effect/vitest";
import {Effect, Ref, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as Id from "../id.ts";
import {
	Small,
	options,
	Delivery,
	clientFixture,
	storeFixture,
	notesFixture,
	type DriveModule,
	type BridgeDown as BridgeFailure,
} from "../mcp/mcp.test-support.ts";

const Step = Schema.Struct({
	outcome: Schema.Literals(["accepted", "refused", "failed"]),
	ms: Small,
});
const Calls = Schema.Array(Step).check(Schema.isMinLength(1), Schema.isMaxLength(30));
type Stored = {
	readonly spans: ReadonlyArray<Record<string, unknown>>;
	readonly health: ReadonlyArray<Record<string, unknown>>;
};
const read = (home: string): Stored => {
	const spans: Record<string, unknown>[] = [],
		health: Record<string, unknown>[] = [];
	for (const file of readdirSync(home, {recursive: true})) {
		if (typeof file !== "string" || !file.endsWith(".db")) continue;
		const db = new DatabaseSync(join(home, file), {readOnly: true});
		try {
			const tables = db
				.prepare("SELECT name FROM sqlite_master WHERE type='table'")
				.all()
				.map((r) => r.name);
			if (tables.includes("spans")) spans.push(...db.prepare("SELECT * FROM spans").all());
			if (tables.includes("health"))
				health.push(...db.prepare("SELECT * FROM health WHERE piece='mcp.call'").all());
		} finally {
			db.close();
		}
	}
	return {spans, health};
};
const recordingLaw = (stored: Stored, calls: ReadonlyArray<typeof Step.Type>) => {
	expect(stored.spans.filter((s) => s.name === "mcp.call")).toHaveLength(calls.length);
	expect(stored.health).toHaveLength(calls.length);
	for (const [i, call] of calls.entries()) {
		const h = stored.health[i]!;
		expect(h.ms).toBe(call.ms);
		expect(h.ok).toBe(call.outcome === "failed" ? 0 : 1);
		expect(h.error).toBe(call.outcome === "failed" ? "BridgeDown" : null);
	}
};
it.effect.prop(
	"L25 durable bridge calls retain durations, outcomes and failure classes",
	{calls: Calls},
	({calls}) =>
		Effect.gen(function* () {
			const home = mkdtempSync("/tmp/fh.");
			try {
				const {agentRecording, BridgeRecording} = yield* Effect.promise(
					() => import("./agent-recording.ts"),
				);
				const {BridgeDown} = yield* Effect.promise(() => import("../mcp/client.ts"));
				const driveApi: DriveModule = yield* Effect.promise(() => import("../mcp/drive.ts"));
				const connection = yield* Id.Generator.use((g) => g.next(Id.Connection));
				const f = yield* clientFixture(),
					store = yield* storeFixture();
				const current = yield* Ref.make(calls[0]!);
				const client = {
					...f.client,
					send: (request: Parameters<typeof f.client.send>[0]) =>
						Effect.gen(function* () {
							const call = yield* Ref.get(current);
							yield* TestClock.adjust(`${call.ms} millis`);
							if (call.outcome === "failed")
								return yield* Effect.fail(new BridgeDown({why: "connection"}));
							yield* f.setDelivery(
								call.outcome === "refused"
									? Delivery.cases.refused.make({why: "changed_elsewhere", now: 1})
									: Delivery.cases.accepted.make({rev: 1, pos: 1}),
							);
							return yield* f.client.send(request);
						}),
				};
				yield* Effect.gen(function* () {
					const drive = yield* driveApi
						.driveFor([notesFixture()], client)
						.pipe(Effect.provide(store.layer));
					for (const [i, call] of calls.entries()) {
						yield* Ref.set(current, call);
						yield* drive
							.call("notes_save", {value: {note: `record-${i}`, base: 0, body: `body-${i}`}})
							.pipe(Effect.exit);
					}
					yield* BridgeRecording.use(
						(r: {readonly flush: Effect.Effect<void, BridgeFailure>}) => r.flush,
					);
				}).pipe(Effect.provide(agentRecording({home, connection})), Effect.scoped);
				const stored = read(home);
				recordingLaw(stored, calls);
				const serialized = JSON.stringify(stored);
				for (const row of stored.spans) {
					const attributes = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject))(
						row.attributes,
					);
					expect(String(attributes["fab.process"] ?? "").startsWith("connection_")).toBe(false);
				}
				for (const call of calls) expect(serialized).toContain(call.outcome);
			} finally {
				rmSync(home, {recursive: true, force: true});
			}
		}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Id.Generator.layer)),
	options,
);
it("plant L25: memory-only recording or missing refusal", () => {
	expect(() => recordingLaw({spans: [], health: []}, [{outcome: "refused", ms: 5}])).toThrow();
	expect(() =>
		recordingLaw({spans: [{name: "mcp.call"}], health: [{ms: 0, ok: 1, error: null}]}, [
			{outcome: "failed", ms: 5},
		]),
	).toThrow();
});
