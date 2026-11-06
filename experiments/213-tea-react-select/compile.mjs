// node experiments/213-tea-react-select/compile.mjs, from any working directory.
// Compiles src.jsx twice, with the React Compiler at experiment 202's settings and without,
// and fails if the Compiler skips any component in it.
import {readFileSync, writeFileSync} from "node:fs";
import {transformSync} from "@babel/core";

// The same settings as experiments/202-tea-react/compile.mjs (from PR 320's note).
const COMPILER = {
	target: "19",
	panicThreshold: "none",
	environment: {validateNoImpureFunctionsInRender: true},
};
const src = readFileSync(new URL("./src.jsx", import.meta.url), "utf8");
const events = [];
const build = (compile) =>
	transformSync(src, {
		cwd: import.meta.dirname,
		filename: "src.jsx",
		babelrc: false,
		configFile: false,
		plugins: [
			...(compile
				? [
						[
							"babel-plugin-react-compiler",
							{...COMPILER, logger: {logEvent: (_f, e) => events.push(e)}},
						],
					]
				: []),
			["@babel/plugin-transform-react-jsx", {runtime: "automatic"}],
		],
	}).code;
writeFileSync(new URL("./out-compiled.mjs", import.meta.url), build(true));
writeFileSync(new URL("./out-plain.mjs", import.meta.url), build(false));
const skipped = events.filter((e) =>
	["CompileError", "CompileSkip", "PipelineError"].includes(e.kind),
);
console.error(`compiler: ${events.map((e) => `${e.kind}(${e.fnName})`).join(", ")}`);
if (skipped.length > 0) throw new Error(`the Compiler skipped ${skipped.length} function(s)`);
