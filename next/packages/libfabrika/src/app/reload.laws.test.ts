// P15a, next/. Plants are named at each law. Missing P15 exports fail inside that law.
import {Deferred, Effect, Fiber, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {ProgramDown, Step} from "./program.ts";
import {
	body,
	checks,
	code,
	type Draw,
	failure,
	Model,
	operations,
	request,
	typeId,
	variant,
	world,
} from "./reload.test-support.ts";
import {Saved} from "./state.ts";

const runSequence = async (draw: Draw<typeof operations>, factors: readonly number[]) => {
	const w = await world(
		factors.map((factor) => ({factor, start: 13, crash: false, v: 1, program: "counter"})),
	);
	try {
		const requests = [];
		for (let i = 0; i < factors.length; i++) requests.push(await w.install(i));
		await w.run(w.runner().open("headless"));
		const accepted = new Map<string, {n: number; hash: string}>();
		let selected = 0;
		let durable: ReadonlyArray<unknown> = [];
		for (const op of draw) {
			if (op.kind === "reload") {
				const i = op.build % factors.length;
				await w.run(w.runner().reload(requests[i]!));
				selected = i;
			} else if (op.kind === "reopen") {
				await w.reopen();
				await w.run(w.runner().open("headless"));
				expect((await w.rows(`${w.name}/inbox`)).slice(0, durable.length)).toEqual(durable);
			} else {
				const input = w.input(op.id, {type: "add", n: op.n});
				const result = await w.run(w.runner().msg(input));
				expect(result._tag).toBe("accepted");
				if (!accepted.has(input.id))
					accepted.set(input.id, {n: op.n, hash: w.bundles[selected]!.hash});
			}
			durable = await w.rows(`${w.name}/inbox`);
			const checkpoint = await w.checkpoint();
			expect(checkpoint?.saved.build).toBe(w.bundles[selected]!.hash);
		}
		const letters = await w.rows(`${w.name}/inbox`);
		const steps = (await w.rows(w.process)).filter((r) => r._tag === "stepped");
		expect(letters.map((r) => r.id)).toEqual([...accepted.keys()]);
		expect(new Set(letters.map((r) => r.rev)).size).toBe(letters.length);
		expect(steps).toHaveLength(accepted.size);
		let count = 13;
		// Independent build-aware oracle. It reads committed entries, never runner state or latest code.
		for (const entry of letters) {
			const applied = steps.filter((r) => body(r).input === entry.id);
			expect(applied).toHaveLength(1);
			const build = body(applied[0]!).build;
			expect(build).toBe(accepted.get(entry.id)?.hash);
			const i = w.bundles.findIndex((b) => b.hash === build);
			expect(i).toBeGreaterThanOrEqual(0);
			const msg = Schema.decodeUnknownSync(Schema.Struct({m: Schema.Struct({n: Schema.Int})}))(
				entry.body,
			);
			count += msg.m.n * factors[i]!;
			expect(await w.run(w.store().placed(entry.id))).toMatchObject({
				id: entry.id,
				rev: entry.rev,
				pos: entry.pos,
			});
		}
		expect(Schema.decodeUnknownSync(Model)((await w.checkpoint())!.saved.model)).toEqual({
			count,
			replies: [],
		});
		await w.reopen();
		await w.run(w.runner().open("headless"));
		expect(await w.rows(`${w.name}/inbox`)).toEqual(letters);
		expect((await w.checkpoint())?.saved.model).toEqual({count, replies: []});
	} finally {
		await w.close();
	}
};

describe("P15a committed program reload", () => {
	it("P12 inspection refuses a candidate without running its init, update or Cmds", async () => {
		// Plant: use init as an inspection call, or install a candidate after failed inspection.
		await fc.assert(
			fc.asyncProperty(fc.integer({min: -10, max: 10}), async (count) => {
				const executions = new Map<
					number,
					Parameters<typeof import("./reload.test-support.ts").executionFixture>[0]
				>();
				const w = await world(
					[1, 2].map((factor) => ({factor, start: count, v: 1, crash: false, program: "counter"})),
					{executions},
				);
				try {
					const model = {count, replies: []};
					executions.set(1, {
						init: Step.cases.stepped.make({model, view: model, cmds: [], wake: null}),
						steps: [],
						upgrade: {
							saved: Saved.make({v: 1, build: w.bundles[1]!.hash, model, after: 0}),
							ran: [],
						},
						inspect: new ProgramDown({why: "saved_state"}),
					});
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					const before = await w.checkpoint();
					expect(await w.run(w.runner().reload(req))).toMatchObject({_tag: "refused"});
					expect(await w.checkpoint()).toEqual(before);
					const calls = w.fixtures.get(1)!.calls.map((c) => c.method);
					expect(calls).toContain("inspect");
					expect(
						calls.filter((method) => ["init", "step", "fold", "reply"].includes(method)),
					).toEqual([]);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("p70: acknowledged facts survive every reload/reopen in order", async () => {
		// Plant: acknowledge before save, or overwrite the latest accepted checkpoint at reload.
		await fc.assert(
			fc.asyncProperty(
				operations,
				fc.tuple(fc.constant(1), fc.constant(3), fc.constant(5)),
				runSequence,
			),
			checks,
		);
	});
	it("p71: resends install one result and one committed step", async () => {
		// Plant: install twice, drop a queued input, or rerun the prepared Cmds while folding.
		await fc.assert(
			fc.asyncProperty(operations, async (ops) => {
				const doubled = ops.flatMap((op) => (op.kind === "message" ? [op, op] : [op]));
				await runSequence(doubled, [1, 2, 4]);
			}),
			checks,
		);
	});
	it("p72: repeated selected hashes leave model, placement, code facts and view unchanged", async () => {
		// Plant: call init, announce again, or publish a window reload on same-hash requests.
		await fc.assert(
			fc.asyncProperty(variant, fc.integer({min: 1, max: 8}), async (spec, repeats) => {
				const w = await world([{...spec, crash: false}]);
				try {
					const req = await w.install(0);
					await w.run(w.runner().open("headless"));
					await w.run(w.runner().msg(w.input(1, {type: "add", n: 7})));
					const saved = await w.checkpoint();
					const facts = await w.rows("code");
					const process = await w.rows(w.process);
					const updates = [...w.updates];
					const calls = [...w.calls];
					for (let n = 0; n < repeats; n++)
						expect(
							await w.run(
								w.runner().reload({...req, id: (await request(w.bundles[0]!, n + 100)).id}),
							),
						).toMatchObject({_tag: "unchanged", code: req.code});
					expect(await w.checkpoint()).toEqual(saved);
					expect(await w.rows("code")).toEqual(facts);
					expect(await w.rows(w.process)).toEqual(process);
					expect(w.updates).toEqual(updates);
					expect(w.calls).toEqual(calls);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("p73: a compatible swap keeps model; history folds by each entry's build", async () => {
		// Plant: replay old history using the newest multiplier.
		await fc.assert(
			fc.asyncProperty(operations, fc.integer({min: 2, max: 7}), (ops, factor) =>
				runSequence(ops, [1, factor, factor + 1]),
			),
			checks,
		);
	});
	it("p73: an awaited step finishes before its queued reload and the next input", async () => {
		// Plant: replace live code from the watch callback while step is awaiting RPC.
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 20}), async (n) => {
				const w = await world(
					[1, 3].map((factor) => ({factor, start: 0, v: 1, crash: false, program: "counter"})),
				);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					w.fault.pauseStep = true;
					await w.run(
						Effect.gen(function* () {
							const first = yield* Effect.forkChild(w.runner().msg(w.input(1, {type: "add", n})));
							yield* Deferred.await(w.stepEntered);
							const reload = yield* Effect.forkChild(w.runner().reload(req));
							const second = yield* Effect.forkChild(w.runner().msg(w.input(2, {type: "add", n})));
							yield* Deferred.succeed(w.stepGate, undefined);
							yield* Fiber.join(first);
							yield* Fiber.join(reload);
							yield* Fiber.join(second);
						}),
					);
					expect((await w.checkpoint())?.saved.model).toEqual({count: n * 4, replies: []});
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("p74: refusal is per process and stable request; a fitting sibling continues", async () => {
		// Plant: select before decode, duplicate a refusal on retry, or block sibling processes.
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 2, max: 6}), async (future) => {
				const specs = [1, 2].map((factor) => ({
					factor,
					start: 4,
					v: 1,
					crash: false,
					program: "counter",
				}));
				const bad = await world([{...specs[0]!, v: future}, specs[1]!]);
				const good = await world(specs, {
					process: typeId("process", 3),
					name: "counter:2",
					shared: bad,
				});
				try {
					await bad.install(0);
					await good.install(0, 100);
					await bad.install(1);
					for (const w of [bad, good]) await w.run(w.runner().open("headless"));
					const saved = (await bad.checkpoint())!;
					const req = await request(bad.bundles[1]!, 15);
					for (let i = 0; i < 3; i++)
						expect(await bad.run(bad.runner().reload(req))).toMatchObject({_tag: "refused"});
					expect((await bad.checkpoint())?.saved).toEqual(saved.saved);
					expect(
						(await bad.rows("code")).filter(
							(r) => r._tag === "code.refused" && body(r).request === req.id,
						),
					).toHaveLength(1);
					expect(
						await good.run(good.runner().reload(await request(good.bundles[1]!, 15))),
					).toMatchObject({_tag: "loaded"});
					await good.run(good.runner().msg(good.input(1, {type: "add", n: 1})));
					expect((await good.checkpoint())?.saved.model).toEqual({count: 6, replies: []});
				} finally {
					await good.close();
					await bad.close();
				}
			}),
			checks,
		);
	});
	it("p75: a failed candidate never steps, even after a reopen", async () => {
		// Plant: select hash before module validation, or import host code as a fallback.
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({min: -5, max: 5}), {minLength: 1, maxLength: 8}),
				async (ns) => {
					const w = await world(
						[1, 9].map((factor) => ({factor, start: 0, v: 1, crash: false, program: "counter"})),
					);
					try {
						await w.install(0);
						const req = await w.install(1);
						await w.run(w.runner().open("headless"));
						w.fault.load = 1;
						await failure(w.use(w.runner().reload(req)));
						for (const [i, n] of ns.entries())
							await w.run(w.runner().msg(w.input(i, {type: "add", n})));
						await w.reopen();
						await w.run(w.runner().open("headless"));
						expect(
							w.calls.filter(
								(c) => c.build === req.code.hash && ["step", "fold", "init"].includes(c.method),
							),
						).toEqual([]);
						expect((await w.checkpoint())?.saved.build).toBe(w.bundles[0]!.hash);
						expect((await w.rows("code")).some((r) => r._tag === "code.failed")).toBe(true);
					} finally {
						await w.close();
					}
				},
			),
			checks,
		);
	});
	it("p76: program activity follows its matching load; brain facts keep brain build", async () => {
		// Plant: step before load, backdate old rows, or stamp the latest build on old work.
		await fc.assert(
			fc.asyncProperty(operations, async (ops) => {
				await runSequence(ops, [1, 2, 3]);
				const w = await world(
					[1, 2].map((factor) => ({factor, start: 0, v: 1, crash: false, program: "counter"})),
				);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					await w.run(w.runner().msg(w.input(0, {type: "add", n: 1})));
					const historical = await w.rows(w.process);
					await w.run(w.runner().reload(req));
					await w.run(w.runner().msg(w.input(1, {type: "add", n: 1})));
					const facts = await w.rows("code");
					const steps = await w.rows(w.process);
					for (const step of steps.filter((r) => r._tag === "stepped")) {
						expect(
							facts.some(
								(r) =>
									r._tag === "code.loaded" && body(r).hash === body(step).build && r.rev < step.rev,
							),
						).toBe(true);
					}
					for (const fact of facts) {
						expect(fact.by).toBe("SHA256:brain");
						expect(fact.build).toBe(facts[0]!.build);
					}
					expect(steps.slice(0, historical.length)).toEqual(historical);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("p77: wrong-program requests cannot select another program's bytes", async () => {
		// Watch dependency edits are checked in local/build.test.ts against the real watcher.
		await fc.assert(
			fc.asyncProperty(
				fc.string({minLength: 1, maxLength: 12}).filter((s) => s !== "counter"),
				async (program) => {
					const w = await world([
						{factor: 1, start: 0, v: 1, crash: false, program: "counter"},
						{factor: 5, start: 0, v: 1, crash: false, program},
					]);
					try {
						await w.install(0);
						const wrong = await w.install(1);
						await w.run(w.runner().open("headless"));
						const before = await w.checkpoint();
						await failure(w.use(w.runner().reload({...wrong, program: "counter"})));
						expect(await w.checkpoint()).toEqual(before);
						expect(w.calls.filter((c) => c.build === wrong.code.hash)).toEqual([]);
					} finally {
						await w.close();
					}
				},
			),
			checks,
		);
	});
	it("p78: pinned policies refuse every candidate; follow allows only a new hash", async () => {
		// Plant: pin is a UI preference, pin is compared to candidate, or malformed hashes decode.
		const {ReloadPolicy, allowsReload} = await import("./reload.ts");
		const {CodeHash} = await code();
		await fc.assert(
			fc.asyncProperty(fc.stringMatching(/^[0-9a-f]{64}$/), variant, async (raw, spec) => {
				const hash = Schema.decodeUnknownSync(CodeHash)(raw);
				const policy = ReloadPolicy.cases.pinned.make({hash});
				expect(await Effect.runPromise(Schema.decodeUnknownEffect(ReloadPolicy)(policy))).toEqual(
					policy,
				);
				await failure(
					Schema.decodeUnknownEffect(ReloadPolicy)({_tag: "pinned", hash: raw.slice(1)}),
				);
				const w = await world(
					[
						{...spec, crash: false},
						{...spec, factor: spec.factor + 1, crash: false},
					],
					{policy},
				);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					const before = await w.checkpoint();
					expect(
						allowsReload(policy, {hash: w.bundles[0]!.hash, window: w.bundles[0]!.window}, req),
					).toBe(false);
					await w.run(w.runner().reload(req));
					expect(await w.checkpoint()).toEqual(before);
					expect(
						allowsReload(
							ReloadPolicy.cases.follow.make({}),
							{hash: w.bundles[0]!.hash, window: w.bundles[0]!.window},
							req,
						),
					).toBe(true);
					expect(allowsReload(ReloadPolicy.cases.follow.make({}), req.code, req)).toBe(false);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
});
