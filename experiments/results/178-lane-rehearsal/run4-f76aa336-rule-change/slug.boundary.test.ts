import fc from "fast-check";
import {expect, it} from "vitest";
import {slugify} from "./slug.ts";

const gardening60 = "growing-tomatoes-in-raised-beds-for-a-healthy-summer-harvest";
const gardening79 = "growing-tomatoes-in-raised-beds-for-a-healthy-summer-harvest-with-organic-mulch";
const gardening80 = "growing-tomatoes-in-raised-beds-for-a-healthy-summer-harvest-and-organic-compost";
const gardening100 = "growing-tomatoes-in-raised-beds-for-a-healthy-summer-harvest-with-organic-mulch-through-every-season";

const titles = fc.oneof(
	fc.string({maxLength: 1000}),
	fc.array(fc.integer({min: 0, max: 0x10ffff}), {maxLength: 300})
		.map((points) => String.fromCodePoint(...points)),
	fc.integer({min: 1, max: 1000})
		.map((length) => `${"a".repeat(length)} b`),
);

it("retains up to 80 ASCII slug characters and removes a hyphen at the cut", () => {
	const cases: Array<[string, string]> = [
		["growing-herbs-in-pots-for-a-summer-garden", "growing-herbs-in-pots-for-a-summer-garden"],
		[gardening60, gardening60],
		[gardening79, gardening79],
		[gardening80, gardening80],
		["growing-tomatoes-in-raised-beds-for-a-healthy-summer-harvest-and-organic-composts", gardening80],
		[gardening100, gardening79],
	];

	const outputs = cases.map(([title]) => slugify(title));
	expect(outputs).toEqual(cases.map(([, expected]) => expected));
});

it("never produces more than 80 characters", () => {
	fc.assert(
		fc.property(titles, (title) => {
			expect(slugify(title).length).toBeLessThanOrEqual(80);
		}),
		{
			seed: 1,
			numRuns: 300,
			examples: [[gardening60], [gardening80], [gardening100], ["a".repeat(1000)]],
		},
	);
});

it("never produces a trailing hyphen", () => {
	fc.assert(
		fc.property(titles, (title) => {
			expect(slugify(title).endsWith("-")).toBe(false);
		}),
		{
			seed: 1,
			numRuns: 300,
			examples: [
				[""],
				["!!!"],
				["Garden ---"],
				[`${"a".repeat(39)} b`],
				[`${"a".repeat(79)} b`],
				[gardening100],
			],
		},
	);
});
