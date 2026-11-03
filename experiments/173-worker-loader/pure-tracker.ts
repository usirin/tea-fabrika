import {statusOf, tickets} from "@tea-fabrika/tracker";
// Part 2, design B, for programs/tracker: its machine (`tickets`, from the package's own exports)
// as a pure step. The tracker uses Effect Schema the most of the repo's programs: five Cmds made
// with tea's Effect `Cmd.define`, a state schema of 15 fields, checks on titles and numbers, and
// a fold over ticket facts from `@kampus/pipeline`. Its Cmds go out as plain data, its Subs too.
import {WorkerEntrypoint} from "cloudflare:workers";
import {seal, usedOf} from "./effect-stub.ts";
import {sandboxOf} from "./sandbox.ts";

const sandbox = sandboxOf(tickets);
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
		return {...out, status: statusOf(out.state as never)};
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
		return new Response("programs/tracker's machine, a pure step");
	},
};
