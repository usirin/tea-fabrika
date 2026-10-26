// Experiment 145's own tests: `pnpm vitest run --config experiments/145-many-objects/vitest.config.ts`.
// They stay out of the top-level `pnpm test`, which runs only the packages' tests. Each test file
// starts Miniflare in its own process; the time limits are the top level's, for the same reasons.
import {defineConfig} from "vitest/config";

export default defineConfig({
	test: {
		root: import.meta.dirname,
		include: ["*.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
