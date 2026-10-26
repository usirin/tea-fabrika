import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {call} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import {tally} from "./small.ts";

describe("tally", () => {
	it("refuses an add past the safe whole numbers, says why, and goes on from the total it kept", async () => {
		const first = -4220048110695276;
		const second = -4787151144045716;
		const storage = memoryStorage();
		const called = await Effect.runPromise(
			call(tally, {}, {told: {add: [first, second, 1]}, keeping: {id: "tally:r1", storage}}),
		);
		expect(called).toMatchObject({kind: "called", ended: {kind: "ended"}});
		expect(called.kind === "called" ? called.heard : []).toEqual([
			{name: "total", value: first},
			{name: "refused", value: {n: second, why: "out_of_range"}},
			{name: "total", value: first + 1},
		]);
		const handle = await Effect.runPromise(storage.open("tally:r1", null));
		expect(
			await Effect.runPromise(handle.read("count", "total", tally.machines.count.state)),
		).toEqual({total: first + 1});
	});
});
