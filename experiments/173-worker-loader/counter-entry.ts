// The repo's own programs/counter, loaded whole: @kampus/fabrika's defineProgram, its schemas
// and its machine. Does the real thing load and step, not only a copy?

import {applyCell} from "@demlik/tea";
import {counter} from "@tea-fabrika/counter";
import {WorkerEntrypoint} from "cloudflare:workers";
import {Schema} from "effect";

const count = counter.machines.count;
const decodeState = Schema.decodeUnknownSync(count.state);

export class Program extends WorkerEntrypoint<any> {
	describe() {
		return {
			name: counter.name,
			description: counter.description,
			inputs: Object.keys(counter.inputs),
		};
	}
	step(model: unknown, msg: {readonly type: "plus"}) {
		const [next, cmds] = applyCell(count.machine, decodeState(model), msg);
		return {model: next, cmds, status: count.status(next)};
	}
}

export default {
	fetch() {
		return new Response("programs/counter");
	},
};
