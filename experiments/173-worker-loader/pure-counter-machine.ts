// Part 2, design B: the counter's machine module alone (./counter-machine.ts) as the pure step.
import {WorkerEntrypoint} from "cloudflare:workers";
import {count, status} from "./counter-machine.ts";
import {seal, usedOf} from "./effect-stub.ts";
import {sandboxOf} from "./sandbox.ts";

const sandbox = sandboxOf(count);
seal();

let calls = 0;
const born = Date.now();

export class Program extends WorkerEntrypoint<any> {
	init() {
		return sandbox.init();
	}
	step(state: unknown, msg: {readonly type: string}) {
		calls++;
		const out = sandbox.step(state, msg);
		return {...out, status: status(out.state as never)};
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
		return new Response("programs/counter's machine module, a pure step");
	},
};
