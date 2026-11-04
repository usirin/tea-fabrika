// Writes ./generated.ts, the long list for the law, from the programs' own parts.
//
//   nice -n 19 node experiments/208-typed-line-gaps/write-generated.ts && pnpm format
//
// No network, no model, $0.

import {writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {programs} from "./desk.ts";
import {generate} from "./generate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const cases = generate(programs);
const body = cases.map((c) => `\t${JSON.stringify(c)},`).join("\n");
writeFileSync(
	join(here, "generated.ts"),
	[
		"// Written by ./write-generated.ts from the programs' own parts; do not edit by hand.",
		"// `why` is the run-time reader's answer. ./agree.test.ts holds the compiler to it, line by",
		"// line, and fails when this file is stale.",
		"export const generated = [",
		body,
		"] as const;",
		"",
	].join("\n"),
);
const ok = cases.filter((c) => c.why === "ok").length;
console.log(JSON.stringify({lines: cases.length, ok, refused: cases.length - ok}));
