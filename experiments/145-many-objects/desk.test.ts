import {Effect} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {layerObject} from "./client.ts";
import {deskOf, openDesk, restore} from "./desk.ts";
import {A, agent, B, personObject, type Running, startServer, user} from "./harness.ts";

let s: Running;
beforeAll(async () => {
	s = await startServer();
});
afterAll(async () => {
	await s.drop();
});

const onA = async () => layerObject(await s.as(user(A)), personObject(A));
/** The first app's open desk: it keeps the lease for the tests below. */
let first: Effect.Success<ReturnType<typeof openDesk>>;

describe("the desk in a person's object", () => {
	it("a first start finds no desk; a saved desk comes back whole", async () => {
		const l = await onA();
		const desk = deskOf(3, 6);
		const got = await Effect.runPromise(
			Effect.gen(function* () {
				const before = yield* restore;
				first = yield* openDesk("app-1");
				yield* first.save(desk, "save-1");
				return {before, after: yield* restore};
			}).pipe(Effect.provide(l)),
		);
		expect(got.before).toBeNull();
		expect(got.after).toEqual(desk);
	});

	it("one app at a time writes the desk: a second hears Held", async () => {
		const l = await onA();
		const second = await Effect.runPromise(
			openDesk("app-2").pipe(
				Effect.map(() => "opened"),
				Effect.catchTag("Held", (e) => Effect.succeed(`held by ${e.holder}`)),
				Effect.provide(l),
			),
		);
		expect(second).toBe("held by app-1");
	});

	it("a save sent again under its id lands once", async () => {
		const l = await onA();
		const again = await Effect.runPromise(first.save(deskOf(1, 1), "save-1"));
		expect(again.dup).toBe(true);
		expect(await Effect.runPromise(restore.pipe(Effect.provide(l)))).toEqual(deskOf(3, 6));
	});

	it("nobody else reads it: not person B, not person A's own agent", async () => {
		for (const who of [user(B), agent(A, "builder")]) {
			const l = layerObject(await s.as(who), personObject(A));
			const r = await Effect.runPromise(
				restore.pipe(
					Effect.map(() => "read"),
					Effect.catchTag("LedgerUnreachable", (e) => Effect.succeed(e.message.slice(0, 3))),
					Effect.provide(l),
				),
			);
			expect(r).toBe("403");
		}
	});
});
