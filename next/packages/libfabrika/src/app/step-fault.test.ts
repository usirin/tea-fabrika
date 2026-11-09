// P27a, next/. The real hook follows a stable fresh letter. P34 owns replacement policy.
import {describe, expect, it} from "@effect/vitest";
import {Cause, Effect, Exit, Layer, Schema} from "effect";
import {
	faultWorld,
	forSchema,
	Positive,
	production,
	request,
	TestProcessId,
	withIds,
	type NemesisModule,
	type StepLiveModule,
	type StepModule,
} from "../chaos/p27.test-support.ts";
import {IdGenerator, InputId} from "../data/id.ts";

describe("P27a fresh step hook", () => {
	it.effect(
		"plant: reset by process ID or poison saved folds; throws follow one fresh letter",
		() =>
			Effect.gen(function* () {
				const S = yield* production<StepLiveModule>("../app/step-fault.ts", "LiveStepFault");
				const N = yield* production<NemesisModule & StepModule>("../app/nemesis.ts", "StepFault");
				yield* forSchema(
					Schema.Struct({target: N.Target, times: Schema.Literals([1, 3]), folds: Positive}),
					({target, times, folds}) =>
						Effect.scoped(
							Effect.gen(function* () {
								const ids = yield* IdGenerator;
								const letter = yield* ids.next(InputId);
								const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)({
									_tag: "step",
									name: target.name,
									process: target.process,
									letter,
									times,
								});
								const fault = yield* Schema.decodeUnknownEffect(N.Fault)({
									_tag: "fail_step",
									pid: target.process,
									times,
								});
								const w = yield* faultWorld({resolve: [hit]});
								const r = yield* request(fault, target);
								yield* w.fire(r);
								const layer = () => S.LiveStepFault.layer.pipe(Layer.provide(w.faults()));
								let process = target.process;
								const errors: string[] = [];
								for (let i = 0; i <= times; i++) {
									for (let n = 0; n < folds; n++)
										yield* N.StepFault.use((s) =>
											s.before({name: target.name, process, letter, phase: "fold"}),
										).pipe(Effect.provide(layer()));
									const other = yield* ids.next(InputId);
									yield* N.StepFault.use((s) =>
										s.before({name: target.name, process, letter: other, phase: "fresh"}),
									).pipe(Effect.provide(layer()));
									const exit = yield* Effect.exit(
										N.StepFault.use((s) =>
											s.before({name: target.name, process, letter, phase: "fresh"}),
										).pipe(Effect.provide(layer())),
									);
									if (i < times) {
										expect(Exit.isFailure(exit)).toBe(true);
										if (Exit.isFailure(exit)) {
											const error = Cause.squash(exit.cause);
											expect(error).toBeInstanceOf(Error);
											errors.push(error instanceof Error ? error.name : "wrong");
										}
									} else expect(Exit.isSuccess(exit)).toBe(true);
									process = yield* ids.next(TestProcessId);
									yield* w.reopen;
								}
								expect(errors).toHaveLength(times);
								const good = yield* ids.next(InputId);
								yield* N.StepFault.use((s) =>
									s.before({name: target.name, process, letter: good, phase: "fresh"}),
								).pipe(Effect.provide(layer()));
							}),
						).pipe(withIds),
				);
			}),
	);
});
