// The package's build: `pnpm build` writes `dist/`, one `.js` and one `.d.ts` per source file
// (bundleless), ESM only. Nothing in this repo needs it: `exports` names `src/`. What is
// packed is `dist/`, which `publishConfig` names and pnpm swaps in.
import {defineConfig} from "@rslib/core";

export default defineConfig({
	lib: [{format: "esm", bundle: false, dts: true, syntax: "es2023"}],
	source: {
		entry: {index: ["./src/**/*.ts", "!./src/**/*.test.ts"]},
		tsconfigPath: "./tsconfig.build.json",
	},
	output: {target: "node"},
	tools: {
		bundlerChain: (chain) => {
			// rslib reads `new URL("./x", import.meta.url)` as an asset and copies `x` into
			// `dist/static/`. Here such a URL names a sibling module or a folder in the repo, not
			// an asset, so it is left as written. `new Worker(new URL(...))` is still rewritten.
			chain.module.rule("rslib:new-url").parser({url: false});
		},
	},
});
