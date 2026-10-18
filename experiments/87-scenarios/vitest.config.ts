// Experiment 87: runs one ticket's feature files with quickpickle, in a scratch
// checkout of the target repository. `87-scenarios.ts` copies this folder to
// `packages/<package>/scen87/` and sets TICKET to the ticket's folder name.
// The package's own `resolve` is kept, so its source imports resolve as they
// do in its own tests; nothing else of its config is.
import {quickpickle} from "quickpickle";
import {defineConfig, type UserConfig} from "vitest/config";
import own from "../vitest.config.ts";

const ticket = process.env.TICKET ?? "";

export default defineConfig({
	plugins: [quickpickle({stepTimeout: 120_000})],
	resolve: (own as UserConfig).resolve ?? {},
	test: {
		root: import.meta.dirname,
		include: [`${ticket}/*.feature`],
		setupFiles: ["lib/common.ts", `${ticket}/steps.ts`],
		testTimeout: 300_000,
	},
});
