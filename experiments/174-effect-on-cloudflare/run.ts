// Run one part: node experiments/174-effect-on-cloudflare/run.ts s1
import {mkdirSync, writeFileSync} from "node:fs";
import {here} from "./harness.ts";

const part = process.argv[2] ?? "s1";
const mod = await import(`./${part}.ts`);
const out = await mod.main();
mkdirSync(here("../results/174-effect-on-cloudflare"), {recursive: true});
const label =
	(process.env.EFFECT_DIST ? "-effect-4.1.1" : "") +
	(process.env.MINIFLARE_PATH ? "-newest-workerd" : "");
writeFileSync(
	here(`../results/174-effect-on-cloudflare/${part}${label}.json`),
	`${JSON.stringify(out, null, "\t")}\n`,
);
console.log(JSON.stringify(out, null, 1));
process.exit(0);
