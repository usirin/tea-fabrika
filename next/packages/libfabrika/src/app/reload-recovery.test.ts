// P15a, next/. All storage is throwaway SQLite. No browser claims belong to this round.
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {ProcessStore} from "../coordination/process-store.ts";
import {ProgramDown, type State} from "./program.ts";
import {body, checks, type Draw, failure, typeId, variant, world} from "./reload.test-support.ts";

const rawState = fc.record({
	n: fc.integer({min: -100, max: 100}),
	payload: fc.jsonValue(),
	after: fc.nat({max: 50}),
});
const StateModel = Schema.Struct({
	n: Schema.Int,
	payload: Schema.Json,
	trail: Schema.Array(Schema.String),
});
const saved = (raw: Draw<typeof rawState>, v: number) => ({
	v,
	build: "old-build",
	after: raw.after,
	model: {n: raw.n, payload: raw.payload, trail: []},
});

describe("P15a saved shapes and recovery", () => {
	it("S3: every named edge runs, even when final decoding already accepts old bytes", async () => {
		// Plant: try final schema first and skip upgrades when it already fits.
		const {Saved} = await import("./state.ts");
		await fc.assert(
			fc.asyncProperty(
				rawState,
				fc.integer({min: 1, max: 5}),
				fc.integer({min: 1, max: 5}),
				async (raw, from, edges) => {
					const original = saved(raw, from);
					const bytes = JSON.stringify(original);
					const ran: string[] = [];
					const names = Array.from({length: edges}, (_, i) => `upgrade-${from + i}`);
					const state: State = {
						v: from + edges,
						schema: StateModel,
						upgrades: names.map((name, i) => ({
							name,
							from: from + i,
							run: (input) => {
								ran.push(name);
								const model = Schema.decodeUnknownSync(StateModel)(input);
								return {...model, n: model.n + i + 1, trail: [...model.trail, name]};
							},
						})),
					};
					const actual = await Effect.runPromise(Saved.upgradeEffect(original, state, "new-build"));
					expect(actual.ran).toEqual(names);
					expect(ran).toEqual(names);
					expect(actual.saved).toEqual({
						v: state.v,
						build: "new-build",
						after: raw.after,
						model: {n: raw.n + (edges * (edges + 1)) / 2, payload: raw.payload, trail: names},
					});
					expect(JSON.stringify(original)).toBe(bytes);
				},
			),
			checks,
		);
	});
	it("S3: gaps, duplicate edges, future state, throws and bad output fail without changing bytes", async () => {
		// Plant: mutate raw, save before final decode, or let an upgrade's exception escape.
		const {Saved} = await import("./state.ts");
		await fc.assert(
			fc.asyncProperty(
				rawState,
				fc.constantFrom("gap", "duplicate", "future", "throw", "output"),
				async (raw, kind) => {
					const original = saved(raw, kind === "future" ? 3 : 1);
					const bytes = JSON.stringify(original);
					const run = (input: unknown) => {
						if (typeof input === "object" && input !== null) Object.assign(input, {n: raw.n + 1});
						if (kind === "throw") throw new RangeError("private upgrade detail");
						return kind === "output" ? {bad: true} : input;
					};
					const upgrades =
						kind === "gap"
							? []
							: kind === "duplicate"
								? [
										{name: "one", from: 1, run},
										{name: "duplicate", from: 1, run},
									]
								: [{name: "one", from: 1, run}];
					expect(
						await failure(
							Saved.upgradeEffect(original, {v: 2, schema: StateModel, upgrades}, "new-build"),
						),
					).toMatchObject({_tag: "ProgramDown", why: "saved_state"});
					expect(JSON.stringify(original)).toBe(bytes);
					const control = await Effect.runPromise(
						Saved.upgradeEffect(
							saved(raw, 1),
							{v: 1, schema: StateModel, upgrades: []},
							"same-shape",
						),
					);
					expect(control.saved.model).toEqual(saved(raw, 1).model);
					expect(control.ran).toEqual([]);
				},
			),
			checks,
		);
	});
	it("malformed saved values use ProgramDown without a defect or input mutation", async () => {
		const {Saved} = await import("./state.ts");
		await fc.assert(
			fc.asyncProperty(
				rawState,
				fc.oneof(fc.jsonValue(), fc.constant(undefined)),
				async (raw, malformed) => {
					// Wrapping guarantees an invalid Saved, including when the generated JSON happens to fit.
					const bad = {v: malformed, build: [], model: raw.payload, after: -1};
					const before = structuredClone(bad);
					expect(
						await failure(
							Saved.upgradeEffect(bad, {v: 1, schema: StateModel, upgrades: []}, "new-build"),
						),
					).toBeInstanceOf(ProgramDown);
					expect(bad).toEqual(before);
				},
			),
			checks,
		);
	});
	it("reload cuts finish once at every prepare/append/commit boundary", async () => {
		// Plant: clear prepared before remote ack, allocate fresh fact IDs, or publish before commit.
		await fc.assert(
			fc.asyncProperty(
				variant,
				fc.constantFrom(
					"before:prepare",
					"after:prepare",
					"before:append",
					"after:append",
					"before:commit",
					"after:commit",
				),
				async (spec, cut) => {
					const w = await world([
						{...spec, crash: false},
						{...spec, factor: spec.factor + 1, crash: false},
					]);
					try {
						await w.install(0);
						const req = await w.install(1);
						await w.run(w.runner().open("headless"));
						await w.run(w.runner().msg(w.input(1, {type: "add", n: 2})));
						const before = await w.checkpoint();
						const published = w.updates.length;
						w.fault.cut = cut;
						await failure(w.use(w.runner().reload(req)));
						// After a required failure, there is no successful view publication.
						expect(w.updates).toHaveLength(published);
						await w.reopen();
						await w.run(w.runner().open("headless"));
						await w.run(w.runner().reload(req));
						await w.run(w.runner().reload(req));
						const after = await w.checkpoint();
						expect(after?.saved.model).toEqual(before?.saved.model);
						expect(after?.saved.build).toBe(req.code.hash);
						const facts = (await w.rows("code")).filter(
							(r) =>
								r._tag === "code.loaded" &&
								body(r).process === w.process &&
								body(r).request === req.id,
						);
						expect(facts).toHaveLength(1);
						const stable = facts[0]!.id;
						await w.reopen();
						await w.run(w.runner().open("headless"));
						expect((await w.rows("code")).filter((r) => r.id === stable)).toHaveLength(1);
						await w.run(w.runner().msg(w.input(2, {type: "add", n: 3})));
						expect((await w.checkpoint())?.saved.model).toMatchObject({
							count: spec.start + 2 * spec.factor + 3 * (spec.factor + 1),
						});
					} finally {
						await w.close();
					}
				},
			),
			checks,
		);
	});
	it("H4: one rollback retries unchanged input and produces no failed-build effects", async () => {
		// Plant: accept failed input early, dispatch its Cmd, or retry the whole outside request.
		// Plan gap: main's stepper erases TypeError into ProgramDown; H4 requires retaining its class.
		await fc.assert(
			fc.asyncProperty(variant, fc.integer({min: 1, max: 10}), async (spec, n) => {
				const w = await world([
					{...spec, crash: false},
					{...spec, factor: spec.factor + 1, crash: true},
				]);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					await w.run(w.runner().reload(req));
					const input = w.input(1, {type: "crash", n});
					expect(await w.run(w.runner().msg(input))).toMatchObject({_tag: "accepted"});
					expect(await w.run(w.runner().msg(input))).toMatchObject({_tag: "accepted"});
					const facts = await w.rows("code");
					const crash = facts.filter((r) => r._tag === "step.crashed");
					const rollback = facts.filter((r) => r._tag === "code.rolled_back");
					expect(crash).toHaveLength(1);
					expect(rollback).toHaveLength(1);
					expect(crash[0]!.rev).toBeLessThan(rollback[0]!.rev);
					expect(body(crash[0]!)).toMatchObject({
						letter: input.id,
						build: req.code.hash,
						error: "TypeError",
					});
					expect(body(rollback[0]!)).toMatchObject({
						letter: input.id,
						from: req.code.hash,
						to: w.bundles[0]!.hash,
						window: w.bundles[0]!.window,
					});
					expect((await w.rows(`${w.name}/inbox`)).filter((r) => r.id === input.id)).toHaveLength(
						1,
					);
					expect(
						(await w.rows(w.process)).filter(
							(r) => r._tag === "stepped" && body(r).input === input.id,
						),
					).toHaveLength(1);
					expect((await w.checkpoint())?.saved).toMatchObject({
						build: w.bundles[0]!.hash,
						model: {count: spec.start + n * spec.factor},
					});
					expect(w.calls.filter((c) => c.method === "handler")).toEqual([]);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("rollback preserves successful work committed after the swap", async () => {
		// Plant: restore ReloadState.before over newer accepted work.
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({min: 1, max: 8}), {minLength: 1, maxLength: 6}),
				async (ns) => {
					const w = await world(
						[false, true].map((crash, i) => ({
							factor: i + 1,
							start: 5,
							v: 1,
							crash,
							program: "counter",
						})),
					);
					try {
						await w.install(0);
						const req = await w.install(1);
						await w.run(w.runner().open("headless"));
						await w.run(w.runner().reload(req));
						for (const [i, n] of ns.entries())
							await w.run(w.runner().msg(w.input(i, {type: "add", n})));
						const history = await w.rows(`${w.name}/inbox`);
						await w.run(w.runner().msg(w.input(100, {type: "crash", n: 3})));
						expect((await w.checkpoint())?.saved.model).toMatchObject({
							count: 8 + 2 * ns.reduce((a, b) => a + b, 0),
						});
						expect((await w.rows(`${w.name}/inbox`)).slice(0, history.length)).toEqual(history);
						await w.reopen();
						await w.run(w.runner().open("headless"));
						expect((await w.checkpoint())?.saved.model).toMatchObject({
							count: 8 + 2 * ns.reduce((a, b) => a + b, 0),
						});
					} finally {
						await w.close();
					}
				},
			),
			checks,
		);
	});
	it("a second throwing build goes down once instead of alternating builds", async () => {
		await fc.assert(
			fc.asyncProperty(variant, async (spec) => {
				const w = await world([
					{...spec, crash: true},
					{...spec, factor: spec.factor + 1, crash: true},
				]);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					await w.run(w.runner().reload(req));
					await failure(w.use(w.runner().msg(w.input(1, {type: "crash", n: 1}))));
					expect((await w.rows("code")).filter((r) => r._tag === "code.rolled_back")).toHaveLength(
						1,
					);
					expect(await w.rows(`${w.name}/inbox`)).toEqual([]);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("newer saved shape on open stops only that process and preserves bytes and pending work", async () => {
		// P15a proves the stopped state; P15b owns wording and rendered Restart.
		await fc.assert(
			fc.asyncProperty(rawState, fc.integer({min: 2, max: 7}), async (raw, version) => {
				const spec = {factor: 1, start: raw.n, v: 1, crash: false, program: "counter"};
				const w = await world([spec]);
				const sibling = await world([spec], {
					process: typeId("process", 3),
					name: "counter:2",
					shared: w,
				});
				try {
					for (const each of [w, sibling]) {
						await each.install(0);
						await each.run(each.runner().open("headless"));
					}
					const cp = (await w.checkpoint())!;
					const next = {
						...cp,
						saved: {...cp.saved, v: version, model: raw.payload},
						turn: {pending: typeId("letter", 50)},
					};
					await w.run(w.store().save(next));
					const bytes = JSON.stringify(await w.checkpoint());
					const letters = await w.rows(`${w.name}/inbox`);
					await w.reopen();
					expect(await failure(w.use(w.runner().open("headless")))).toMatchObject({
						why: "saved_state",
					});
					expect(JSON.stringify(await w.checkpoint())).toBe(bytes);
					expect(await w.rows(`${w.name}/inbox`)).toEqual(letters);
					expect(
						(await w.rows(`processes/${w.name}`)).some(
							(r) => r._tag === "exited" && body(r).process === w.process,
						),
					).toBe(true);
					expect(
						(await sibling.rows(`processes/${sibling.name}`)).filter((r) => r._tag === "exited"),
					).toEqual([]);
					expect(w.calls.filter((c) => c.method === "init" && c.input !== null)).toEqual([]);
					await sibling.run(sibling.runner().msg(sibling.input(1, {type: "add", n: 1})));
					expect((await sibling.checkpoint())?.saved.model).toMatchObject({count: raw.n + 1});
				} finally {
					await sibling.close();
					await w.close();
				}
			}),
			checks,
		);
	});
	it("newer committed shape on rollback stops without restoring the older boundary snapshot", async () => {
		// Plant: downgrade, restore before, discard the failed letter, or stop every process.
		await fc.assert(
			fc.asyncProperty(variant, fc.integer({min: 1, max: 9}), async (spec, n) => {
				const w = await world([
					{...spec, v: 1, crash: false},
					{...spec, v: 2, crash: true},
				]);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					await w.run(w.runner().reload(req));
					await w.run(w.runner().msg(w.input(1, {type: "add", n})));
					const committed = (await w.checkpoint())!.saved;
					const history = await w.rows(`${w.name}/inbox`);
					expect(committed.v).toBe(2);
					expect(
						(await w.rows(w.process)).filter((r) => r._tag === "state.upgraded").map(body),
					).toContainEqual(
						expect.objectContaining({from: 1, to: 2, ran: ["shape-1"], build: req.code.hash}),
					);
					const input = w.input(2, {type: "crash", n});
					await failure(w.use(w.runner().msg(input)));
					expect((await w.checkpoint())?.saved).toEqual(committed);
					expect(await w.rows(`${w.name}/inbox`)).toEqual(history);
					const facts = await w.rows("code");
					expect(
						facts.some((r) => r._tag === "code.failed" && body(r).why === "rollback_state"),
					).toBe(true);
					expect(facts.filter((r) => r._tag === "code.rolled_back")).toEqual([]);
					expect(
						(await w.rows(`processes/${w.name}`)).some(
							(r) => r._tag === "exited" && body(r).process === w.process,
						),
					).toBe(true);
					expect(JSON.stringify(await w.checkpoint())).toContain(input.id);
					await w.reopen();
					await failure(w.use(w.runner().open("headless")));
					expect((await w.checkpoint())?.saved).toEqual(committed);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("ReloadState JSON cuts retain the selected/previous hashes, before model and fact identities", async () => {
		const {ReloadState} = await import("./reload.ts");
		await fc.assert(
			fc.asyncProperty(variant, async (spec) => {
				const w = await world([
					{...spec, crash: false},
					{...spec, factor: spec.factor + 1, crash: false},
				]);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					w.fault.cut = "after:prepare";
					await failure(w.use(w.runner().reload(req)));
					const journal = await w.run(w.store().loadReload);
					expect(journal?._tag).toBe("prepared");
					const decoded = Schema.decodeUnknownSync(ReloadState)(
						JSON.parse(JSON.stringify(journal)),
					);
					expect(decoded).toEqual(journal);
					await w.reopen();
					expect(await w.run(w.store().loadReload)).toEqual(decoded);
					await w.run(w.runner().open("headless"));
					await w.run(w.runner().msg(w.input(7, {type: "work", n: 1})));
					expect(w.calls.filter((c) => c.method === "handler").map((c) => c.build)).toEqual([
						req.code.hash,
					]);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("commitReload is atomic on storage failure; malformed journal is LedgerError, never reset", async () => {
		await fc.assert(
			fc.asyncProperty(variant, fc.jsonValue(), async (spec, raw) => {
				const w = await world([{...spec, crash: false}]);
				try {
					await w.install(0);
					await w.run(w.runner().open("headless"));
					const before = await w.checkpoint();
					const {ReloadState} = await import("./reload.ts");
					const state = ReloadState.cases.first.make({
						current: {hash: w.bundles[0]!.hash, window: w.bundles[0]!.window},
					});
					const beforeReload = await w.run(w.store().loadReload);
					w.processDisk.fault.afterTransaction = true;
					await failure(
						w.use(
							w
								.store()
								.commitReload(
									{...before!, saved: {...before!.saved, model: {changed: true}}},
									state,
								),
						),
					);
					expect(await w.checkpoint()).toEqual(before);
					expect(await w.run(w.store().loadReload)).toEqual(beforeReload);
					// Corrupt only the outside journal bytes, without prescribing a SQL table layout.
					await w.run(w.store().saveReload(state));
					let corruptions = 0;
					w.processDisk.fault.rows = (query, rows) =>
						!/^SELECT/i.test(query)
							? rows
							: rows.map((row) =>
									Object.fromEntries(
										Object.entries(row).map(([key, value]) => {
											if (
												typeof value !== "string" ||
												!value.includes(w.bundles[0]!.hash) ||
												!value.includes('"first"')
											)
												return [key, value];
											corruptions++;
											return [key, JSON.stringify({broken: raw})];
										}),
									),
								);
					expect(await failure(w.use(ProcessStore.use((s) => s.loadReload)))).toMatchObject({
						_tag: "LedgerError",
						why: "bad_row",
					});
					expect(corruptions).toBeGreaterThan(0);
					w.processDisk.fault.rows = (_q, rows) => rows;
					expect(await w.checkpoint()).toEqual(before);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
});
