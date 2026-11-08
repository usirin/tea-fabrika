// P17b, next/. Every turn below goes through the real ProgramRunner and SQLite.
import {Outcome} from "@demlik/tea";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Fiber, Option, Schema} from "effect";
import * as fc from "fast-check";
import {
	fixtureId,
	LAW,
	library,
	makeWorld,
	program,
	records,
	start,
	TARGET_PROCESS,
	timing,
} from "./chaos.test-support.ts";

const drive = Effect.fn("chaos.test.drive")(function* (
	w: Effect.Success<ReturnType<typeof makeWorld>>,
	late: ReadonlyArray<number>,
) {
	for (let n = 0; n < 12 && w.wake() !== null; n++)
		yield* w.due(w.wake()! + (late[n % late.length] ?? 0));
	expect(w.wake()).toBeNull();
});

describe("P17b real runner laws", () => {
	it("p34 plant, fire before installation: every controlled fire reads its saved Asked and installed view", async () => {
		await fc.assert(
			fc.asyncProperty(start, timing, fc.nat(), async (raw, times, cut) => {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							const A = yield* library();
							const w = yield* makeWorld({from: times.from});
							const value = {
								...raw,
								target: {
									...raw.target,
									program: "counter",
									name: w.targetName,
									process: TARGET_PROCESS,
								},
							};
							expect(yield* w.start(value)).toMatchObject({_tag: "accepted"});
							for (let n = 0; n < raw.most; n++) {
								if (n === cut % raw.most) yield* w.reopen;
								const due = w.wake();
								expect(due).not.toBeNull();
								yield* w.due(due! + times.late[n]!);
							}
							expect(w.fired).toHaveLength(raw.most);
							const timesAsked: number[] = [];
							for (const fire of w.fired) {
								const asked = records(A.Asked, fire.model).find((a) => a.tick === fire.tick);
								expect(asked).toMatchObject({
									tick: fire.tick,
									fault: fire.fault,
									process: TARGET_PROCESS,
								});
								timesAsked.push(asked!.at);
								const model = yield* Schema.decodeUnknownEffect(A.ChaosState)(fire.model);
								expect(fire.view).toEqual(A.ChaosState.view(model));
							}
							for (let n = 1; n < timesAsked.length; n++)
								expect(timesAsked[n]! - timesAsked[n - 1]!).toBeGreaterThanOrEqual(raw.gap);
						}),
					),
				);
			}),
			{...LAW, numRuns: 25},
		);
	});

	it("p35 plant, new timer ID or replay Cmd: repeated alarms and storage reloads never refire", async () => {
		await fc.assert(
			fc.asyncProperty(
				start,
				timing,
				fc.integer({min: 1, max: 5}),
				fc.integer({min: 1, max: 3}),
				fc.nat(),
				async (raw, times, duplicates, replays, cut) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const w = yield* makeWorld({from: times.from});
								yield* w.start({
									...raw,
									target: {
										...raw.target,
										program: "counter",
										name: w.targetName,
										process: TARGET_PROCESS,
									},
								});
								for (let n = 0; n < raw.most; n++) {
									const at = w.wake()! + times.late[n]!;
									if (n === cut % raw.most) yield* w.reopen;
									yield* w.due(at);
									for (let k = 0; k < duplicates; k++) {
										if (k < replays) yield* w.reopen;
										yield* w.due(at);
									}
									expect(w.fired).toHaveLength(n + 1);
								}
								for (let k = 0; k < replays; k++) yield* w.reopen;
								expect(w.fired).toHaveLength(raw.most);
								expect(new Set(w.fired.map((f) => f.tick)).size).toBe(raw.most);
								const timers = (yield* w.letters("chaos:1")).filter(
									(row) =>
										typeof row.m === "object" &&
										row.m !== null &&
										"type" in row.m &&
										row.m.type === "timer",
								);
								expect(timers).toHaveLength(raw.most);
								for (const row of timers) {
									const timer = yield* Schema.decodeUnknownEffect(
										Schema.Struct({id: Schema.String, type: Schema.Literal("timer")}),
									)(row.m);
									expect(timer.id).toMatch(/^input_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
									expect(w.fired.some((f) => f.tick === timer.id)).toBe(true);
								}
							}),
						),
					);
				},
			),
			{...LAW, numRuns: 25},
		);
	});

	it("p35 plant, fire handler shared with another program: only chaos receives it", async () => {
		const A = await Effect.runPromise(library());
		const {chaos} = await Effect.runPromise(program());
		const COUNTER = "@kampus/counter";
		const {counter} = await import(COUNTER);
		await fc.assert(
			fc.asyncProperty(
				fc.oneof(fc.constantFrom("chaos", "counter", "notes"), fc.string({minLength: 1})),
				start,
				async (name, raw) => {
					let calls = 0;
					await Effect.runPromise(
						Effect.gen(function* () {
							const loader = yield* A.ProgramLoader;
							const loaded = yield* loader.load(name);
							const fire = loaded.handler("fire");
							expect(Option.isSome(fire)).toBe(name === "chaos");
							if (Option.isSome(fire)) {
								const planned = yield* Effect.fromResult(
									A.planFaults({...Schema.decodeUnknownSync(A.Start)(raw), from: 0}),
								);
								yield* fire.value({
									type: "fire",
									id: raw.id,
									tick: fixtureId("input", 1),
									fault: planned[0]!.fault,
								});
							}
						}).pipe(
							Effect.provide(
								A.ProgramLoader.layer(
									{[name]: name === "chaos" ? chaos : counter},
									{
										fire: () =>
											Effect.sync(() => {
												calls++;
												return Outcome.ok(A.Fired.cases.fired.make({}));
											}),
									},
								),
							),
						),
					);
					expect(calls).toBe(name === "chaos" ? 1 : 0);
				},
			),
			LAW,
		);
	});

	it("plant, turn failed fire into ok: refusals and errors remain saved against their exact ticks", async () => {
		await fc.assert(
			fc.asyncProperty(
				start,
				timing,
				fc.constantFrom("fired" as const, "refused" as const, "off" as const, "failed" as const),
				async (raw, times, mode) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const A = yield* library();
								const w = yield* makeWorld({mode, from: times.from});
								yield* w.start({
									...raw,
									target: {
										...raw.target,
										program: "counter",
										name: w.targetName,
										process: TARGET_PROCESS,
									},
								});
								yield* drive(w, times.late);
								const did = records(A.Did, yield* w.model);
								expect(did).toHaveLength(raw.most);
								for (const hit of w.fired) {
									const answer = did.find((d) => d.tick === hit.tick);
									expect(answer?._tag).toBe(mode === "fired" ? "ok" : "refused");
									if (answer?._tag === "refused")
										expect(answer.why).toBe(
											mode === "refused"
												? "not_granted"
												: mode === "off"
													? "off"
													: "handler_failed",
										);
								}
								const saved = yield* w.letters("chaos:1");
								const replies = saved.flatMap((row) =>
									records(
										Schema.Struct({
											type: Schema.Literals(["fire_ok", "fire_err"]),
											cmd: Schema.Struct({tick: Schema.String}),
										}),
										row.m,
									),
								);
								expect(replies.map((r) => r.cmd.tick).sort()).toEqual(
									w.fired.map((f) => f.tick).sort(),
								);
								const spans = yield* w.jobRows;
								const commands = spans.filter(
									(s) => s.name === "runner.cmd" && s.attributes["fab.runner.cmd"] === "fire",
								);
								expect(commands).toHaveLength(raw.most);
								for (const hit of w.fired)
									expect(spans.some((s) => s.attributes["fab.nemesis.tick"] === hit.tick)).toBe(
										true,
									);
								for (const span of spans)
									expect(JSON.stringify(span.attributes)).not.toContain("planted handler failure");
							}),
						),
					);
				},
			),
			{...LAW, numRuns: 25},
		);
	});

	it("plant, report a failed check as clean: check errors keep the experiment incomplete", async () => {
		await fc.assert(
			fc.asyncProperty(
				start,
				timing,
				fc.constantFrom("off" as const, "failed" as const),
				async (raw, times, checkMode) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const A = yield* library();
								const w = yield* makeWorld({checkMode, from: times.from});
								yield* w.start({
									...raw,
									target: {
										...raw.target,
										program: "counter",
										name: w.targetName,
										process: TARGET_PROCESS,
									},
								});
								yield* drive(w, times.late);
								yield* w.reopen;
								expect(records(A.Asked, yield* w.model)).toHaveLength(raw.most);
								expect(records(A.Did, yield* w.model)).toHaveLength(raw.most);
								expect(records(A.Checked, yield* w.model)).toHaveLength(0);
								const replies = (yield* w.letters("chaos:1")).flatMap((r) =>
									records(
										Schema.Struct({type: Schema.Literal("check_err"), why: Schema.String}),
										r.m,
									),
								);
								expect(replies).toHaveLength(1);
								expect(replies[0]!.why).toBe(checkMode === "off" ? "off" : "handler_failed");
							}),
						),
					);
				},
			),
			{...LAW, numRuns: 20},
		);
	});

	it("plant, hide interrupted work: an unanswered tick survives reopen and later faults still run", async () => {
		await fc.assert(
			fc.asyncProperty(start, timing, async (raw, times) => {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							const A = yield* library();
							const w = yield* makeWorld({mode: "interrupted", from: times.from});
							yield* w.start({
								...raw,
								target: {
									...raw.target,
									program: "counter",
									name: w.targetName,
									process: TARGET_PROCESS,
								},
							});
							for (let n = 0; n < raw.most; n++) {
								const fiber = yield* Effect.forkChild(w.due(w.wake()! + times.late[n]!));
								yield* Fiber.await(fiber);
								yield* w.reopen;
							}
							const model = yield* w.model;
							expect(records(A.Asked, model)).toHaveLength(raw.most);
							expect(records(A.Did, model)).toHaveLength(0);
							expect(w.fired).toHaveLength(raw.most);
							expect(w.wake()).toBeNull();
						}),
					),
				);
			}),
			{...LAW, numRuns: 20},
		);
	});
});
