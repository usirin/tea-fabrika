import {counter} from "@tea-fabrika/counter";
// Part 2, design B, for the repo's own programs/counter: its `count` machine as a pure step.
// The program is imported as its author wrote it; the hands decide what `effect` is in the build
// (the real one, or ./effect-stub.ts, which throws if the update touches Effect at run time).
import {WorkerEntrypoint} from "cloudflare:workers";
import {seal, usedOf} from "./effect-stub.ts";
import {sandboxOf} from "./sandbox.ts";

const count = counter.machines.count;
const sandbox = sandboxOf(count.machine);
seal();

// One per isolate: it says whether two calls met the same isolate.
let calls = 0;
const born = Date.now();

export class Program extends WorkerEntrypoint<any> {
	init() {
		return sandbox.init();
	}
	step(state: unknown, msg: {readonly type: string}) {
		calls++;
		const out = sandbox.step(state, msg);
		return {...out, status: count.status(out.state as never)};
	}
	isolate() {
		calls++;
		return {calls, born};
	}
	effect() {
		return usedOf();
	}
}

export default {
	fetch() {
		return new Response("programs/counter, a pure step");
	},
};
