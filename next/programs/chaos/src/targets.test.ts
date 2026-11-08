// P17b, next/. Targets remain the actual counter and P13 notes programs.
// StepFault supplies defects at the fresh boundary; it implements no recovery behavior.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {fixtureId, LAW, library, makeWorld, type NotesSave} from "./chaos.test-support.ts";

describe("P17b real targets", () => {
	it("plant, copied toy target: the actual counter keeps generated arithmetic through reload", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.constantFrom("inc" as const, "dec" as const, "reset" as const), {
					minLength: 1,
					maxLength: 25,
				}),
				fc.nat(),
				async (commands, cut) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const w = yield* makeWorld({target: "counter"});
								let count = 0;
								for (const [n, type] of commands.entries()) {
									if (n === cut % commands.length) yield* w.reopen;
									expect(yield* w.send("counter", {type})).toMatchObject({_tag: "accepted"});
									count = type === "reset" ? 0 : count + (type === "inc" ? 1 : -1);
									expect((yield* w.targetView).view).toEqual({count});
								}
								yield* w.reopen;
								expect((yield* w.targetView).view).toEqual({count});
								expect(yield* w.letters(w.targetName)).toHaveLength(commands.length);
							}),
						),
					);
				},
			),
			{...LAW, numRuns: 25},
		);
	});

	it("plant, fake P13 or lost terminal refusal: actual notes preserve saved text and original replies", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.string({maxLength: 100}), {minLength: 2, maxLength: 10}),
				fc.nat(),
				fc.integer({min: 1, max: 20}),
				async (bodies, cut, noteNumber) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const w = yield* makeWorld({target: "notes"});
								const note = fixtureId("note", noteNumber);
								const accepted: Array<{id: string; input: NotesSave; reply: unknown}> = [];
								for (const [base, body] of bodies.entries()) {
									if (base === cut % bodies.length) yield* w.reopen;
									const input: NotesSave = {type: "save", value: {note, base, body, how: "done"}};
									const id = fixtureId("input", 100 + base);
									const reply = yield* w.send("notes", input, id);
									expect(reply).toMatchObject({_tag: "accepted"});
									accepted.push({id, input, reply});
								}
								const stale: NotesSave = {
									type: "save",
									value: {note, base: 0, body: "refused text"},
								};
								const staleId = fixtureId("input", 500);
								const refused = yield* w.send("notes", stale, staleId);
								expect(refused).toMatchObject({
									_tag: "refused",
									why: "changed_elsewhere",
									now: bodies.length,
								});
								const before = yield* w.targetView;
								yield* w.reopen;
								expect(yield* w.send("notes", stale, staleId)).toEqual(refused);
								for (const prior of accepted)
									expect(yield* w.send("notes", prior.input, prior.id)).toEqual(prior.reply);
								expect(yield* w.targetView).toEqual(before);
								const history = yield* w.letters(w.targetName);
								expect(history.map((r) => r.m)).toEqual(accepted.map((r) => r.input));
								expect(before.view).toEqual({
									notes: [{note, version: bodies.length, body: bodies.at(-1)!}],
								});
							}),
						),
					);
				},
			),
			{...LAW, numRuns: 20},
		);
	});

	it("plant, reset poison counts per process or poison three letters: one letter throws on three successors", async () => {
		const draws = fc.record({
			target: fc.constantFrom("counter" as const, "notes" as const),
			letter: fc.integer({min: 100, max: 1000}),
			reopens: fc.array(fc.boolean(), {minLength: 3, maxLength: 3}),
			resends: fc.integer({min: 1, max: 5}),
			errors: fc.array(
				fc.constantFrom("TypeError" as const, "RangeError" as const, "SyntaxError" as const),
				{minLength: 3, maxLength: 3},
			),
			others: fc.integer({min: 1, max: 3}),
			successors: fc.uniqueArray(fc.integer({min: 20, max: 400}), {minLength: 4, maxLength: 4}),
		});
		await fc.assert(
			fc.asyncProperty(draws, async (draw) => {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							const A = yield* library();
							const letter = fixtureId("input", draw.letter);
							const attempts: Array<{
								name: string;
								process: string;
								letter: string;
								phase: string;
							}> = [];
							const seen: Array<{name: string; process: string; letter: string; phase: string}> =
								[];
							const before: (typeof A.StepFault)["Service"]["before"] = (attempt) =>
								Effect.suspend(() => {
									seen.push(attempt);
									if (attempt.letter !== letter || attempt.phase !== "fresh") return Effect.void;
									attempts.push(attempt);
									const name = draw.errors[attempts.length - 1];
									if (name === "TypeError") return Effect.die(new TypeError("planted first class"));
									if (name === "RangeError")
										return Effect.die(new RangeError("planted second class"));
									if (name === "SyntaxError")
										return Effect.die(new SyntaxError("planted third class"));
									return Effect.void;
								});
							const w = yield* makeWorld({
								target: draw.target,
								before,
								successors: draw.successors.map((n) => fixtureId("process", n)),
							});
							const input =
								draw.target === "counter"
									? {type: "inc"}
									: {
											type: "save",
											value: {note: fixtureId("note", 1), base: 0, body: "fresh text"},
										};
							for (let n = 0; n < 3; n++) {
								const other =
									draw.target === "counter"
										? {type: "dec"}
										: {
												type: "save",
												value: {note: fixtureId("note", n + 10), base: 0, body: `between ${n}`},
											};
								expect(
									yield* w.send(draw.target, other, fixtureId("input", 3000 + n)),
								).toMatchObject({_tag: "accepted"});
								const reply = yield* w.send(draw.target, input, letter).pipe(Effect.exit);
								if (n < 2) expect(reply._tag).toBe("Failure");
								else
									expect(reply).toMatchObject({
										_tag: "Success",
										value: {_tag: "refused", why: "dead"},
									});
								if (draw.reopens[n]) yield* w.reopen;
								// Answer the actual saved recovery deadline; no test-written successor loop.
								const at = w.targetWake();
								if (at !== null) {
									yield* TestClock.setTime(at);
									yield* w.targetDue(at);
								}
							}
							for (let n = 0; n < draw.resends; n++)
								expect(yield* w.send(draw.target, input, letter)).toMatchObject({
									_tag: "refused",
									why: "dead",
								});
							expect(attempts).toHaveLength(3);
							expect(new Set(attempts.map((a) => a.process)).size).toBe(3);
							expect(new Set(attempts.map((a) => a.name))).toEqual(new Set([w.targetName]));
							const dead = (yield* Effect.forEach(attempts, (a) => w.entries(`${a.process}/dead`), {
								concurrency: 1,
							})).flat();
							expect(dead).toHaveLength(1);
							expect(dead[0]!.body).toMatchObject({
								m: letter,
								tries: 3,
								limit: 3,
								errors: draw.errors,
							});
							const restarts = (yield* w.entries(`processes/${w.targetName}`)).filter(
								(r) => r._tag === "restarted",
							);
							for (let n = 1; n < attempts.length; n++)
								expect(
									restarts.some((r) =>
										Schema.is(
											Schema.Struct({
												after: Schema.Literal(attempts[n - 1]!.process),
												process: Schema.Literal(attempts[n]!.process),
											}),
										)(r.body),
									),
								).toBe(true);
							for (let n = 0; n < draw.others; n++) {
								const other =
									draw.target === "counter"
										? {type: "inc"}
										: {
												type: "save",
												value: {note: fixtureId("note", n + 2), base: 0, body: `other ${n}`},
											};
								expect(
									yield* w.send(draw.target, other, fixtureId("input", 2000 + n)),
								).toMatchObject({_tag: "accepted"});
							}
							expect(seen.filter((a) => a.letter === letter && a.phase === "saved")).toHaveLength(
								0,
							);
						}),
					).pipe(Effect.provide(TestClock.layer())),
				);
			}),
			{...LAW, numRuns: 20},
		);
	});
});
