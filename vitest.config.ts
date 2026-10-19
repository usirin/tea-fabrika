import {defineConfig} from "vitest/config";

// One run over every package. `fixtures/` holds toy repos with their own
// `node --test` files. They are the lane's subject, not this repo's tests.
export default defineConfig({
	test: {
		include: [
			"packages/*/src/**/*.test.ts",
			"programs/*/src/**/*.test.ts",
			"packs/*/src/**/*.test.ts",
			"wip/src/**/*.test.ts",
			"legacy/src/**/*.test.ts",
		],
	},
});
