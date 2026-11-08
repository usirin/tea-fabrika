// P15a, next/. H5 checks dispatch, reply validation, targets and durable journals together.
import {Deferred, Effect, Fiber, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {body, checks, failure, request, variant, world} from "./reload.test-support.ts";

describe("P15a in-flight Cmds and Restart", () => {
	it("H5/p71/p76: dispatched Cmd keeps its originating handler, reply schema, target and build", async () => {
		// Plant: use the new handler/schema, resend the Cmd, or retarget the answer to a successor.
		await fc.assert(
			fc.asyncProperty(variant, fc.integer({min: 1, max: 9}), async (spec, n) => {
				const w = await world([
					{...spec, crash: false},
					{...spec, factor: spec.factor + 1, crash: false},
				]);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					w.fault.pauseHandler = true;
					await w.run(
						Effect.gen(function* () {
							const sending = yield* Effect.forkChild(
								w.runner().msg(w.input(1, {type: "work", n})),
							);
							yield* Deferred.await(w.handlerEntered);
							const cp = yield* w.store().load;
							expect(cp?.cmds).toHaveLength(1);
							expect(cp?.cmds[0]).toMatchObject({build: w.bundles[0]!.hash});
							yield* w.runner().reload(req);
							yield* Deferred.succeed(w.handlerGate, undefined);
							yield* Fiber.join(sending);
						}),
					);
					const handlers = w.calls.filter((c) => c.method === "handler");
					expect(handlers.map((c) => c.build)).toEqual([w.bundles[0]!.hash]);
					const replies = w.calls.filter((c) => c.method === "reply");
					expect(replies.map((c) => c.build)).toEqual([w.bundles[0]!.hash]);
					expect((await w.checkpoint())?.saved.model).toMatchObject({replies: [spec.factor]});
					const answers = (await w.rows(`${w.name}/inbox`)).filter((r) => r.id.endsWith("/answer"));
					expect(answers).toHaveLength(1);
					expect(answers[0]!.build).toBe(w.bundles[0]!.hash);
					expect(answers[0]!.id.startsWith(`${w.process}/`)).toBe(true);
					const facts = await w.rows("code");
					expect(
						facts.some(
							(r) =>
								r._tag === "code.loaded" &&
								body(r).hash === answers[0]!.build &&
								r.rev < answers[0]!.rev,
						),
					).toBe(true);
					expect((await w.checkpoint())?.cmds).toEqual([]);
					await w.reopen();
					await w.run(w.runner().open("headless"));
					expect(w.calls.filter((c) => c.method === "handler")).toHaveLength(1);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("H5: a lost answer acknowledgement reopens on saved code without dispatching work twice", async () => {
		// Plant: reuse the current reply schema for an old Cmd; repeat outside work after lost ack.
		await fc.assert(
			fc.asyncProperty(
				variant,
				fc.constantFrom("before:answer", "after:answer"),
				async (spec, cut) => {
					const w = await world([
						{...spec, crash: false},
						{...spec, factor: spec.factor + 1, crash: false},
					]);
					try {
						await w.install(0);
						const req = await w.install(1);
						await w.run(w.runner().open("headless"));
						w.fault.cut = cut;
						await failure(w.use(w.runner().msg(w.input(1, {type: "work", n: 7}))));
						await w.run(w.runner().reload(req));
						await w.reopen();
						await w.run(w.runner().open("headless"));
						const letters = await w.rows(`${w.name}/inbox`);
						expect(letters.filter((r) => r.id.endsWith("/answer"))).toHaveLength(1);
						expect((await w.checkpoint())?.saved.model).toMatchObject({replies: [spec.factor]});
						// Before append there is no receipt: P34 owns that uncertainty. After append is definite.
						if (cut === "after:answer")
							expect(w.calls.filter((c) => c.method === "handler")).toHaveLength(1);
						expect(
							w.calls
								.filter((c) => c.method === "reply")
								.every((c) => c.build === w.bundles[0]!.hash),
						).toBe(true);
					} finally {
						await w.close();
					}
				},
			),
			checks,
		);
	});
	it("Restart: a stable request returns one successor, selected init and preserved history", async () => {
		// Plant: one successor per resend, old init, or historical Cmd dispatch.
		await fc.assert(
			fc.asyncProperty(variant, fc.integer({min: 1, max: 5}), async (spec, retries) => {
				const w = await world([
					{...spec, start: 2, crash: false},
					{...spec, start: 17, factor: spec.factor + 1, crash: false},
				]);
				try {
					await w.install(0);
					await w.install(1);
					await w.run(w.runner().open("headless"));
					await w.run(w.runner().msg(w.input(1, {type: "work", n: 2})));
					await w.run(w.runner().msg(w.input(2, {type: "add", n: 3})));
					const history = await w.rows(`${w.name}/inbox`);
					const dispatches = w.calls.filter((c) => c.method === "handler").length;
					const req = {id: (await request(w.bundles[1]!, 70)).id, build: w.bundles[1]!.hash};
					const first = await w.run(w.runner().restart(req));
					expect(first.process).not.toBe(w.process);
					for (let i = 0; i < retries; i++) {
						await w.reopen();
						expect(await w.run(w.runner().restart(req))).toEqual(first);
					}
					expect(await w.rows(`${w.name}/inbox`)).toEqual(history);
					expect(w.calls.filter((c) => c.method === "handler")).toHaveLength(dispatches);
					expect(
						w.calls.some((c) => c.method === "init" && c.build === req.build && c.input === null),
					).toBe(true);
					const lifecycles = await w.rows("processes");
					expect(
						lifecycles.filter((r) => r._tag === "started" && body(r).process === first.process),
					).toHaveLength(1);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
	it("late answers remain with the old process after explicit replacement", async () => {
		await fc.assert(
			fc.asyncProperty(variant, async (spec) => {
				const w = await world([
					{...spec, crash: false},
					{...spec, factor: spec.factor + 1, crash: false},
				]);
				try {
					await w.install(0);
					await w.install(1);
					await w.run(w.runner().open("headless"));
					w.fault.pauseHandler = true;
					await w.run(
						Effect.gen(function* () {
							const work = yield* Effect.forkChild(
								w.runner().msg(w.input(1, {type: "work", n: 1})),
							);
							yield* Deferred.await(w.handlerEntered);
							const {RestartRequest} = yield* Effect.promise(() => import("./runner.ts"));
							const {RequestId} = yield* Effect.promise(() => import("../data/id.ts"));
							const req = RestartRequest.make({
								id: Schema.decodeUnknownSync(RequestId)("request_01j0000000e0080000000000070"),
								build: w.bundles[1]!.hash,
							});
							const next = yield* w.runner().restart(req);
							yield* Deferred.succeed(w.handlerGate, undefined);
							yield* Fiber.join(work).pipe(Effect.exit);
							expect(next.process).not.toBe(w.process);
						}),
					);
					const answers = (await w.rows(`${w.name}/inbox`)).filter((r) => r.id.endsWith("/answer"));
					for (const answer of answers) {
						expect(answer.id.startsWith(`${w.process}/`)).toBe(true);
						expect(answer.build).toBe(w.bundles[0]!.hash);
					}
					expect(w.calls.filter((c) => c.method === "handler")).toHaveLength(1);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
});
