// The stage runner selects this root; these tests stay out of ordinary library runs.
import {defineConfig} from "vitest/config";
export default defineConfig({
	test: {
		include: ["*.test.ts"],
		fileParallelism: false,
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
});
