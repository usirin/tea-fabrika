import {defineConfig} from "vitest/config";

// One run over every package. `fixtures/` holds toy repos with their own
// `node --test` files. They are the lane's subject, not this repo's tests.
export default defineConfig({
	test: {
		include: [
			"apps/*/src/**/*.test.ts",
			"packages/*/src/**/*.test.ts",
			"programs/*/src/**/*.test.ts",
			"packs/*/src/**/*.test.ts",
			"wip/src/**/*.test.ts",
			"legacy/src/**/*.test.ts",
		],
		// One time limit for every test, chosen from measured times, not vitest's 5 s default,
		// which turned main red 6 times for slow tests and found no bug (experiment 125).
		// Measured on 2026-10-24: the slowest test in 128 CI runs took 17.9 s (60 s is 3.3 times
		// that); with two whole suites side by side on one laptop, the slowest took 28.4 s (60 s
		// is 2.1 times that). A test does not set its own limit to get room on a busy machine; if
		// tests grow slower, measure again and change this number.
		testTimeout: 60_000,
		// The same limit for a `beforeAll` or `afterAll`, for the same reason, not vitest's 10 s
		// default, which failed a git set-up on CI once with no bug (code-host-local). A hook is
		// set-up for its tests, so it gets their limit. Measured on 2026-10-24 with three whole
		// suites side by side: no file's hooks took more than 1.5 s in all.
		hookTimeout: 60_000,
	},
});
