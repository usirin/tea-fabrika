// P27a, next/. Saved handler answers on the real runner. Plants name the behavior to remove.
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {describe, expect, expectTypeOf, it} from "@effect/vitest";
import {Effect, Exit, Option, Schema} from "effect";
import * as fc from "fast-check";
import {
	faultWorld,
	forSchema,
	LAW,
	Positive,
	production,
	request,
	SEED,
	TestProcessId,
	withIds,
	type CompletionModule,
	type EntryModule,
	type NemesisModule,
	type Reply,
} from "../chaos/p27.test-support.ts";
import {IdGenerator} from "../data/id.ts";
import {ProgramLoader} from "./entry.ts";
import {Program} from "./program.ts";
import {ProgramRunner} from "./runner.ts";

const letters = (rows: ReadonlyArray<{body: unknown}>) =>
	rows.filter((r) =>
		Schema.is(Schema.Struct({m: Schema.Struct({type: Schema.Literals(["fire_ok", "fire_err"])})}))(
			r.body,
		),
	);

describe("P27a handler completion", () => {
	it.effect.prop(
		"p35 plant: give counter the fire handler; only chaos receives it",
		{
			name: Schema.Literals(["chaos", "counter", "notes", "unknown"]),
			payload: Schema.Json,
		},
		({name, payload}) =>
			Effect.gen(function* () {
				const fire = Cmd.make("fire", {
					input: Schema.Struct({payload: Schema.Json}),
					ok: Schema.Null,
					err: [],
				});
				const machine = Machine.make({
					model: Schema.Int,
					msg: Schema.Struct({type: Schema.Literal("ask")}),
					cmds: [fire],
					init: () => [0, []],
					update: {ask: (s) => [s, [fire({payload})]], fire_ok: (s) => [s, []]},
				});
				const p = Program.make({
					name,
					machine,
					state: {v: 1, upgrades: []},
					view: (s) => s,
					inputs: {ask: "Ask"},
					outputs: {},
					writes: {},
					refuse: () => null,
					wake: () => null,
				});
				const loaded = yield* ProgramLoader.use((l) => l.load(name)).pipe(
					Effect.provide(
						ProgramLoader.layer({[name]: p}, {fire: () => Effect.succeed(Outcome.ok(null))}),
					),
				);
				expect(Option.isSome(loaded.handler("fire"))).toBe(name === "chaos");
			}),
		LAW,
	);

	it.effect("p35 plant: call target before the triggering letter is saved", () =>
		Effect.gen(function* () {
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "Fault");
			yield* forSchema(Schema.Struct({fault: N.Fault, target: N.Target}), ({fault, target}) =>
				Effect.scoped(
					Effect.gen(function* () {
						const w = yield* faultWorld();
						const r = yield* request(fault, target);
						yield* w.fire(r);
						for (const call of w.calls) {
							expect(call.entries.some((e) => e.parent === r.tick)).toBe(true);
							expect(call.context).toMatchObject({
								process: w.descriptor.id,
								name: "chaos:1",
								parent: r.tick,
							});
							expect(call.context.cmd.length).toBeGreaterThan(0);
						}
						expect(w.contexts).toHaveLength(1);
					}),
				).pipe(withIds),
			);
		}),
	);

	it.effect("plant: pending writes fire_ok or did.ok; an arm alone has no answer", () =>
		Effect.gen(function* () {
			yield* production<EntryModule>("../app/entry.ts", "PendingHandler");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "Fault");
			yield* forSchema(Schema.Struct({fault: N.Fault, target: N.Target}), ({fault, target}) =>
				Effect.scoped(
					Effect.gen(function* () {
						const w = yield* faultWorld({pending: true});
						const r = yield* request(fault, target);
						yield* w.fire(r);
						expect(letters(yield* w.read("chaos:1/inbox"))).toHaveLength(0);
						expect(
							(yield* w.read(`chaos/${r.id}`)).filter((e) => e._tag === "chaos.did"),
						).toHaveLength(0);
					}),
				).pipe(withIds),
			);
		}),
	);

	it.effect("p35 plant: never call a real target or call it before saving its input", () =>
		Effect.gen(function* () {
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "FaultHit");
			yield* forSchema(N.Target, (target) =>
				Effect.scoped(
					Effect.gen(function* () {
						const session = yield* (yield* IdGenerator).next(TestProcessId);
						const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)({
							_tag: "client",
							client: target.client,
							session,
							key: target.key,
							gateway: "gateway-a",
						});
						const fault = yield* Schema.decodeUnknownEffect(N.Fault)({
							_tag: "drop_socket",
							client: target.client,
						});
						const w = yield* faultWorld({resolve: [hit]});
						const r = yield* request(fault, target);
						yield* w.fire(r);
						expect(w.calls).toHaveLength(1);
						expect(w.calls[0]!.entries.some((e) => e.parent === r.tick)).toBe(true);
					}),
				).pipe(withIds),
			);
		}),
	);

	it.effect(
		"plant: memory-only pending or duplicate answer; completions survive sleep and lost replies",
		() =>
			Effect.gen(function* () {
				yield* production<CompletionModule>("../app/runner.ts", "completeHandler");
				const N = yield* production<NemesisModule>("../app/nemesis.ts", "Fired");
				yield* forSchema(
					Schema.Struct({fault: N.Fault, target: N.Target, outcome: N.Fired, repeats: Positive}),
					({fault, target, outcome, repeats}) =>
						Effect.scoped(
							Effect.gen(function* () {
								const w = yield* faultWorld({pending: true});
								const r = yield* request(fault, target);
								yield* w.fire(r);
								const context = w.contexts[0]!;
								const reply: Reply = {
									process: context.process,
									cmd: context.cmd,
									outcome: Outcome.ok(outcome),
								};
								// Draw the cut independently of product state. Every retry reopens the real files.
								const cuts = fc.sample(fc.tuple(fc.integer({min: 0, max: 12}), fc.boolean()), {
									seed: SEED,
									numRuns: repeats,
								});
								for (const [at, after] of cuts) {
									w.stores.ledger.cut.at = at;
									w.stores.ledger.cut.after = after;
									w.stores.ledger.cut.writes = 0;
									yield* Effect.exit(w.complete(reply));
									w.stores.ledger.cut.at = -1;
									yield* w.reopen;
								}
								yield* w.complete(reply);
								yield* w.complete(reply);
								expect(letters(yield* w.read("chaos:1/inbox"))).toHaveLength(1);
								const view = yield* ProgramRunner.use((runner) => runner.open("reader")).pipe(
									Effect.provide(w.layer()),
								);
								expect(view.view).toMatchObject({answers: 1});
								expect(w.contexts).toHaveLength(1);
							}),
						).pipe(withIds),
				);
			}),
	);

	it.effect("plant: accept a changed duplicate or malformed outcome", () =>
		Effect.gen(function* () {
			yield* production<CompletionModule>("../app/runner.ts", "completeHandler");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "Fault");
			yield* forSchema(
				Schema.Struct({fault: N.Fault, target: N.Target, invalid: Schema.String}),
				({fault, target, invalid}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const w = yield* faultWorld({pending: true});
							const r = yield* request(fault, target);
							yield* w.fire(r);
							const context = w.contexts[0]!;
							const reply = {
								process: context.process,
								cmd: context.cmd,
								outcome: Outcome.ok({bad: invalid}),
							};
							expect(Exit.isFailure(yield* Effect.exit(w.complete(reply)))).toBe(true);
							expect(letters(yield* w.read("chaos:1/inbox"))).toHaveLength(0);
							const good = {
								process: context.process,
								cmd: context.cmd,
								outcome: Outcome.ok({_tag: "fired"}),
							};
							yield* w.complete(good);
							const conflict = yield* Effect.exit(
								w.complete({...good, outcome: Outcome.ok({_tag: "refused", why: "unavailable"})}),
							);
							expect(Exit.isFailure(conflict)).toBe(true);
							expect(letters(yield* w.read("chaos:1/inbox"))).toHaveLength(1);
						}),
					).pipe(withIds),
			);
		}),
	);

	it.effect("plant: complete by current name; an old answer cannot drive its successor", () =>
		Effect.gen(function* () {
			yield* production<CompletionModule>("../app/runner.ts", "completeHandler");
			const N = yield* production<NemesisModule>("../app/nemesis.ts", "Target");
			yield* forSchema(
				Schema.Struct({
					fault: N.Fault,
					target: N.Target,
					count: Schema.Int.check(Schema.isBetween({minimum: 2, maximum: 10})),
				}),
				({fault, target, count}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const w = yield* faultWorld({pending: true});
							const r = yield* request(fault, target);
							yield* w.fire(r);
							const original = w.contexts[0]!;
							const ids = yield* IdGenerator;
							for (let i = 0; i < count; i++) {
								const stranger = yield* ids.next(TestProcessId);
								const wrong = yield* Effect.exit(
									w.complete({
										process: stranger,
										cmd: original.cmd,
										outcome: Outcome.ok({_tag: "fired"}),
									}),
								);
								expect(Exit.isFailure(wrong)).toBe(true);
								const successor = {...w.descriptor, id: stranger};
								const before = yield* ProgramRunner.use((runner) =>
									runner.open("successor-reader"),
								).pipe(Effect.provide(w.layer(successor)));
								yield* Effect.exit(
									w.completeIn(
										{
											process: original.process,
											cmd: original.cmd,
											outcome: Outcome.ok({_tag: "fired"}),
										},
										successor,
									),
								);
								const after = yield* ProgramRunner.use((runner) =>
									runner.open("successor-reader"),
								).pipe(Effect.provide(w.layer(successor)));
								expect(after.view).toEqual(before.view);
							}
							yield* w.complete({
								process: original.process,
								cmd: original.cmd,
								outcome: Outcome.ok({_tag: "fired"}),
							});
							expect(letters(yield* w.read("chaos:1/inbox"))).toHaveLength(1);
						}),
					).pipe(withIds),
			);
		}),
	);

	it.effect("type: outside completion keeps Effect and typed failures", () =>
		Effect.gen(function* () {
			const {completeHandler} = yield* production<CompletionModule>(
				"../app/runner.ts",
				"completeHandler",
			);
			expectTypeOf<ReturnType<typeof completeHandler>>().toExtend<
				Effect.Effect<void, unknown, ProgramRunner>
			>();
			expectTypeOf<Effect.Error<ReturnType<typeof completeHandler>>>().not.toBeAny();
		}),
	);
});
