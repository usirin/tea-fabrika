import type {Ledger} from "@kampus/fabrika-old";
import {type LawResult, runLaws} from "@kampus/fabrika-old/laws";
import {Effect, type Layer} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {door, httpLayer, layerObject, type Server} from "./client.ts";
import {A, agent, OPERATOR, type Running, startServer, user} from "./harness.ts";
import {HOME_BREAKS, layerLanes, TABLE_BREAKS, TABLE_SOMETIMES} from "./lanes.ts";

let s: Running;
let builder: Server;
beforeAll(async () => {
	s = await startServer();
	builder = await s.as(agent(A, "builder"));
	const op = await s.as(user(OPERATOR));
	await Effect.runPromise(
		door(op, "project/lab", "create", {founder: A}).pipe(Effect.provide(httpLayer)),
	);
});
afterAll(async () => {
	await s.drop();
});

const lawsOn = (layer: Layer.Layer<Ledger, unknown>) =>
	Effect.runPromise(
		runLaws({alarm: true, graceMs: 1000}).pipe(Effect.provide(layer), Effect.scoped),
	);
const broken = (rs: readonly LawResult[]) =>
	rs.filter((r) => !r.pass).map((r) => r.law.split(".")[0] ?? "");

describe("the ledger's laws", () => {
	it("hold on one project's object, behind the door, for an agent of a member", async () => {
		const rs = await lawsOn(layerObject(builder, "project/lab"));
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});

	// The two lists below are what experiment 145 measured. A change that makes a law pass, or
	// breaks one more, fails here and should be written up.
	it("one object per name, fences by table: these break", async () => {
		const rs = await lawsOn(layerLanes(builder, "lab", "table"));
		expect(rs.length).toBe(27);
		const got = broken(rs);
		expect(got.filter((l) => !TABLE_SOMETIMES.includes(l))).toEqual(TABLE_BREAKS);
	});

	it("one object per name, fences carry their home: these break", async () => {
		const rs = await lawsOn(layerLanes(builder, "lab", "home"));
		expect(rs.length).toBe(27);
		expect(broken(rs)).toEqual(HOME_BREAKS);
	});
});
