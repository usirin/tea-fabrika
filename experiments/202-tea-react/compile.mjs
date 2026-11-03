// node experiments/202-tea-react/compile.mjs, from any working directory.
// Writes the generated modules beside this script; the runners call it automatically.
// Compile p3-src.jsx twice: with the React Compiler at PR 320's settings, and without.
import {readFileSync, writeFileSync} from "node:fs";
import {transformSync} from "@babel/core";

// PR 320, docs/direction/react-compiler.md: const COMPILER = {target: "19", panicThreshold: "none", environment: {validateNoImpureFunctionsInRender: true}};
const COMPILER = {
	target: "19",
	panicThreshold: "none",
	environment: {validateNoImpureFunctionsInRender: true},
};
const src = readFileSync(new URL("./p3-src.jsx", import.meta.url), "utf8");
const events = [];
const build = (compile) =>
	transformSync(src, {
		cwd: import.meta.dirname,
		filename: "p3-src.jsx",
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
console.error(
	`compiler events at PR 320 settings: ${events.map((e) => `${e.kind}(${e.fnName})`).join(", ")}`,
);
