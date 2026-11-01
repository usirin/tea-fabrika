import {Ledger} from "@kampus/fabrika-old";
import {Duration, Effect, Stream} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {door, httpLayer, layerObject} from "./client.ts";
import {A, agent, B, OPERATOR, personObject, type Running, startServer, user} from "./harness.ts";
import {countOf, NAME, runCounter} from "./programs.ts";

let s: Running;
beforeAll(async () => {
	s = await startServer();
	const op = await s.as(user(OPERATOR));
	await Effect.runPromise(
		door(op, "project/acme", "create", {founder: A}).pipe(Effect.provide(httpLayer)),
	);
});
afterAll(async () => {
	await s.drop();
});

describe("one program, any object", () => {
	it("the same counter runs on a project's object and on a person's, each on its own rows", async () => {
		const builder = await s.as(agent(A, "builder"));
		const a = await s.as(user(A));
		const onProject = layerObject(builder, "project/acme");
		const onPerson = layerObject(a, personObject(A));
		const [p, q] = await Promise.all([
			Effect.runPromise(runCounter("host-project", 5).pipe(Effect.provide(onProject))),
			Effect.runPromise(runCounter("host-person", 3).pipe(Effect.provide(onPerson))),
		]);
		expect([p.count, q.count]).toEqual([5, 3]);
		// Each object holds its own counter: the same name, apart.
		const inbox = (layer: typeof onProject) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const l = yield* Ledger;
					return (yield* l.readStream(`${NAME}/inbox`)).length;
				}).pipe(Effect.provide(layer)),
			);
		expect([await inbox(onProject), await inbox(onPerson)]).toEqual([5, 3]);
		expect(await Effect.runPromise(countOf.pipe(Effect.provide(onPerson)))).toBe(3);
	});

	it("the doorbell's socket opens to the object's people only", async () => {
		const ring = async (who: Parameters<Running["as"]>[0]) => {
			const l = layerObject(await s.as(who), personObject(A));
			return Effect.runPromise(
				Effect.gen(function* () {
					const ledger = yield* Ledger;
					return yield* ledger.watch("anything").pipe(
						Stream.take(1),
						Stream.runCollect,
						Effect.timeout(Duration.seconds(2)),
						Effect.as("rang"),
						Effect.orElseSucceed(() => "silent"),
					);
				}).pipe(Effect.provide(l)),
			);
		};
		expect(await ring(user(A))).toBe("rang");
		expect(await ring(user(B))).toBe("silent");
		expect(await ring(agent(A, "builder"))).toBe("silent");
	});
});
