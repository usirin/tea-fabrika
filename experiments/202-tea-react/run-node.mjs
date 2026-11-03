// node experiments/202-tea-react/run-node.mjs [repetitions=20]. Optional jsdom pass.
// Compiles P3 first. Prints observations; P2 and compiled P3 deliberately differ from want.
import "./compile.mjs";
import {JSDOM} from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const {runAll} = await import("./probes.mjs");
const times = Number(process.argv[2] ?? 20);
for (const r of await runAll(times)) console.log(JSON.stringify(r));
process.exit(0);
