// P27a, next/. scenario: actual WebSockets, object resets, alarms and permanent reads together.
import {mkdtempSync, rmSync} from "node:fs";
import {beforeAll, beforeEach, describe, expect, it} from "@effect/vitest";
import {IdGenerator} from "@kampus/libfabrika/data";
import {Cause, Effect, Exit, Schema} from "effect";
import {stageFaults, offWork, SEED, type StageResult} from "./chaos-live.test-support.ts";

let observed: StageResult;
let loaded: Exit.Exit<StageResult, unknown>;
describe("P27a actual local stage", () => {
	beforeAll(async () => {
		loaded = await Effect.runPromiseExit(
			Effect.scoped(
				Effect.gen(function* () {
					const home = yield* Effect.acquireRelease(
						Effect.sync(() => mkdtempSync("/tmp/fh.XXXX-")),
						(h) => Effect.sync(() => rmSync(h, {recursive: true, force: true})),
					);
					return yield* stageFaults({url: "", home, stage: "local", seed: SEED});
				}),
			).pipe(Effect.provide(IdGenerator.layer)),
		);
	});
	beforeEach(() => {
		if (Exit.isFailure(loaded)) throw Cause.squash(loaded.cause);
		observed = loaded.value;
	});

	it("scenario: p37 plant, guard only start; every chaos control rejects an unknown key", () => {
		expect(observed.controls.map((c) => c.msg).sort()).toEqual(["start", "stop"]);
		for (const control of observed.controls)
			expect(control.unknown).toMatchObject({error: expect.anything()});
	});
	it("scenario: p37 plant, trust an old socket; revoke stops every later control write", () => {
		for (const control of observed.controls)
			expect(control.revoked).toMatchObject({error: expect.anything()});
	});
	it("scenario: p37 plant, author from params; forged control fields never become stored authors", () => {
		const controlInputs = observed.evidence.entries.filter((e) => e.stream === "chaos:1/inbox");
		expect(controlInputs.length).toBeGreaterThan(0);
		expect(controlInputs.every((e) => e.for !== "forged-owner")).toBe(true);
		expect(controlInputs.every((e) => e.by !== "forged-owner")).toBe(true);
		for (const control of observed.controls) {
			const accepted = controlInputs.filter((e) => e.id === control.input);
			expect(accepted.length).toBeGreaterThan(0);
			expect(accepted.every((e) => e.by === control.by && e.for === "test-owner")).toBe(true);
		}
	});
	it("scenario: plant, close a newer session or abort a replacement instance; hit identities stay exact", () => {
		expect(observed.cases.length).toBeGreaterThanOrEqual(7);
		for (const report of observed.reports) {
			expect(report._tag).toBe("complete");
			for (const row of report.rows) expect(row.hits.length).toBeGreaterThan(0);
		}
	});
	it("scenario: plant, drop before placing or suppress an unrelated frame; accepted resend has its first placing", () => {
		expect(observed.cases.some((c) => c.fault === "drop_answer")).toBe(true);
		const dropped = observed.reports
			.flatMap((r) => r.rows)
			.filter((r) => r.fault._tag === "drop_answer");
		expect(dropped.length).toBeGreaterThan(0);
		for (const row of dropped) expect(row.recovery._tag).toBe("reconnected");
	});
	it("scenario: plant, memory timer or duplicate release; delay survives real wake and alarms", () => {
		const delayed = observed.reports.flatMap((r) => r.rows).filter((r) => r.fault._tag === "delay");
		expect(delayed.length).toBeGreaterThan(0);
		for (const row of delayed) expect(row.recovery._tag).toBe("continued");
	});
	it("scenario: plant, RPC rejection counts as abort; every saved member has a changed instance", () => {
		for (const name of ["abort", "abort_all"]) {
			const rows = observed.reports.flatMap((r) => r.rows).filter((r) => r.fault._tag === name);
			expect(rows.length, name).toBeGreaterThan(0);
			for (const row of rows) expect(row.recovery._tag).toBe("woke");
		}
	});
	it("scenario: plant, retry count keyed by process; one input has three original throw classes and one dead record", () => {
		const dead = observed.evidence.entries.filter((e) => e._tag === "dead");
		expect(dead.length).toBeGreaterThan(0);
		for (const row of dead) {
			const value = Schema.decodeUnknownSync(
				Schema.Struct({tries: Schema.Int, errors: Schema.Array(Schema.String)}),
			)(row.body);
			expect(value.tries).toBe(3);
			expect(value.errors).toHaveLength(3);
		}
	});
	it("scenario: plant, regrant a revoked key; it stays removed while the other client keeps working", () => {
		expect(
			observed.reports
				.flatMap((r) => r.rows)
				.some((r) => r.fault._tag === "revoke_key" && r.recovery._tag === "removed"),
		).toBe(true);
		expect(observed.controls.every((c) => c.revoked !== null)).toBe(true);
	});
	it("scenario: p91 plant, first page or private recovery table; a fresh permanent-only read gives four answers", () => {
		expect(observed.evidence.entries.length).toBeGreaterThan(256);
		expect(observed.evidence.spans.length).toBeGreaterThan(500);
		expect(observed.report._tag).toBe("complete");
		expect(observed.reports.flatMap((r) => r.rows).length).toBeGreaterThanOrEqual(7);
		for (const row of observed.reports.flatMap((r) => r.rows))
			expect(["waiting", "unknown"]).not.toContain(row.recovery._tag);
	});
	it("scenario: plant, remove acknowledged inbox work but keep latest view; every accepted operation and note version survives", () => {
		expect(observed.expected.length).toBeGreaterThan(512);
		for (const op of observed.expected) {
			const matches = observed.evidence.entries.filter((e) => e.id === op.input);
			expect(matches.length, op.input).toBeGreaterThan(0);
			expect(matches.some((e) => e.rev === op.placing.rev && e.pos === op.placing.pos)).toBe(true);
			for (const e of matches) expect(e.body).toMatchObject({m: op.payload});
		}
	});
});

it.effect(
	"scenario: off plant, remove ordinary dispatch or notes with chaos; both real programs still save work",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const home = yield* Effect.acquireRelease(
					Effect.sync(() => mkdtempSync("/tmp/fh.XXXX-")),
					(h) => Effect.sync(() => rmSync(h, {recursive: true, force: true})),
				);
				const world = yield* offWork(home).pipe(Effect.provide(IdGenerator.layer));
				expect(world.chaos).toEqual([]);
				expect(world.saved).toHaveLength(6);
				for (const op of world.saved) expect(op.answer).toMatchObject({result: {_tag: "accepted"}});
				expect(world.counter).toHaveLength(3);
				expect(world.notes.filter((e) => e._tag === "send")).toHaveLength(3);
			}),
		),
);
