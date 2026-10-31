// Experiment 173: can a program's code be loaded into the brain at run time with Worker Loader?
// The hands (Node) bundle a tea program and key it by sha256; a core Durable Object in Miniflare
// gets an isolate for that hash and steps the program through it. The parts and the program
// live in ./173-worker-loader/ (a workspace package, so esbuild resolves there).
//
// STEPS (default 1000) steps per measurement; COLD (default 20) cold loads per bundle.
// No key, no model, no network beyond Miniflare on this machine.
// Results: results/173-worker-loader.json.
import {main} from "./173-worker-loader/main.ts";

await main();
