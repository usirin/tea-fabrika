// Samples machine.ts alone with the repo's own sampler: every line counts as changed.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sample } from "../../.agents/skills/mutation/scripts/sample.ts";
const file = "next/packages/tuval/src/window/machine.ts";
const content = readFileSync(file, "utf8");
const changed = content.split("\n").map((_, n) => ({ file, line: n + 1 }));
const require = createRequire(resolve("packages/pipeline/package.json"));
const { Instrumenter } = await import(pathToFileURL(require.resolve("@stryker-mutator/instrumenter")).href);
const nop = () => {};
const logger = { debug: nop, info: nop, warn: nop, error: nop, trace: nop, fatal: nop, isDebugEnabled: () => false };
const result = await new Instrumenter(logger).instrument([{ name: file, content, mutate: true }], { plugins: null, ignorers: [], excludedMutations: [] });
const candidates = result.mutants.map((m: any) => ({ ...m, location: { start: { ...m.location.start, line: m.location.start.line + 1 }, end: { ...m.location.end, line: m.location.end.line + 1 } } }));
const report = sample({ candidates, changed, seed: 119120, max: 150 });
writeFileSync("runs/exp-law-size/sample.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.ranges));
console.error(`total ${report.total} selected ${report.selected} left ${report.left}`);
