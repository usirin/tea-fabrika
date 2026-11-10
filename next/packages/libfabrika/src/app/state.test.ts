// S3, next/. Saved.upgrade(saved, state, build) returns {saved, ran}; no I/O.
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";

const Model = Schema.Struct({count: Schema.Int, step: Schema.Int});
const old = {v: 1, model: {n: 7}, build: "old-build", after: 12};
const N = Schema.Struct({n: Schema.Int});
const Count = Schema.Struct({count: Schema.Int});

const state = (calls: string[] = []) => ({
	v: 3,
	schema: Model,
	upgrades: [
		{
			name: "n_to_count",
			from: 1,
			run: (raw: unknown) => {
				calls.push("n_to_count");
				return {count: Schema.decodeUnknownSync(N)(raw).n};
			},
		},
		{
			name: "add_step",
			from: 2,
			run: (raw: unknown) => {
				calls.push("add_step");
				return {...Schema.decodeUnknownSync(Count)(raw), step: 1};
			},
		},
	],
});

describe("S3 saved state and named upgrades", () => {
	for (const [v, model, ran] of [
		[1, {n: 7}, ["n_to_count", "add_step"]],
		[2, {count: 7}, ["add_step"]],
		[3, {count: 7, step: 1}, []],
	] as const) {
		it(`plant, skip an upgrade: version ${v} follows exactly the remaining named chain`, async () => {
			const {Saved} = await import("./state.ts");
			const calls: string[] = [];
			const result = Saved.upgrade({...old, v, model}, state(calls), "new-build");
			expect(result).toEqual({
				saved: {v: 3, model: {count: 7, step: 1}, build: "new-build", after: 12},
				ran,
			});
			expect(calls).toEqual(ran);
		});
	}

	for (const fault of ["gap", "duplicate", "future", "throw", "decode", "zero"] as const) {
		it(`plant, accept ${fault}: failed upgrades leave the original saved bytes intact`, async () => {
			const {Saved} = await import("./state.ts");
			const raw = {...old, v: fault === "future" ? 4 : fault === "zero" ? 0 : 1};
			const before = JSON.stringify(raw);
			const normal = state();
			const upgrades =
				fault === "gap"
					? normal.upgrades.slice(1)
					: fault === "duplicate"
						? [...normal.upgrades, normal.upgrades[0]!]
						: fault === "throw"
							? [
									{
										name: "broken",
										from: 1,
										run: () => {
											throw new Error("upgrade detail");
										},
									},
									normal.upgrades[1]!,
								]
							: fault === "decode"
								? [
										normal.upgrades[0]!,
										{name: "bad_model", from: 2, run: () => ({count: "bad", step: 1})},
									]
								: normal.upgrades;
			expect(() => Saved.upgrade(raw, {...normal, upgrades}, "new-build")).toThrowError(
				expect.objectContaining({_tag: "ProgramDown", why: "saved_state"}),
			);
			expect(JSON.stringify(raw)).toBe(before);
		});
	}

	it("plant, upgrade in place: even a mutating failed upgrade cannot destroy saved bytes", async () => {
		const {Saved} = await import("./state.ts");
		const raw = JSON.parse(JSON.stringify(old));
		const upgrades = [
			{
				name: "mutating",
				from: 1,
				run: (value: unknown) => {
					Object.assign(Schema.decodeUnknownSync(Schema.Struct({n: Schema.Int}))(value), {n: 99});

					if (typeof value === "object" && value !== null) {
						Object.assign(value, {n: 99});
					}

					throw new Error("upgrade failed");
				},
			},
		];
		expect(() => Saved.upgrade(raw, {...state(), upgrades}, "new-build")).toThrow();
		expect(raw).toEqual(old);
	});
	it("plant, omit a save field: version, build and inbox cursor survive JSON text", async () => {
		const {Saved} = await import("./state.ts");
		const current = {v: 3, model: {count: 7, step: 1}, build: "b-123", after: 29};
		const text = Schema.encodeSync(Schema.fromJsonString(Saved))(current);
		expect(Schema.decodeUnknownSync(Schema.fromJsonString(Saved))(text)).toEqual(current);

		for (const bad of [
			{...current, v: 0},
			{...current, build: ""},
			{...current, after: -1},
		]) {
			expect(() => Schema.decodeUnknownSync(Saved)(bad)).toThrow();
		}
	});
});
