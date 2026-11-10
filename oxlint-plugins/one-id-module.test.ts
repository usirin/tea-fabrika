import * as fc from "fast-check";
import {expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

it("refuses the retired Id module for generated contents and permits other module paths", async () => {
	await fc.assert(
		fc.asyncProperty(fc.string(), fc.integer(), async (text, count) => {
			for (const body of [
				"",
				`export const value = ${JSON.stringify(text)};`,
				`export const value = ${count};`,
				'export * from "../id.ts";',
			]) {
				const retired = "next/packages/libfabrika/src/data/id.ts";
				const allowed = [
					"next/packages/libfabrika/src/id.ts",
					"next/packages/libfabrika/src/data/id.test.ts",
					"next/packages/libfabrika/src/transport/id.ts",
					"packages/fabrika/src/data/id.ts",
				];
				const linted = await plant(
					Object.fromEntries([retired, ...allowed].map((path) => [path, body])),
				);
				expect(linted("fabrika(one-id-module)", retired)).toEqual([1]);
				for (const path of allowed) expect(linted("fabrika(one-id-module)", path)).toEqual([]);
			}
		}),
		{seed: 119120, numRuns: 10},
	);
});
