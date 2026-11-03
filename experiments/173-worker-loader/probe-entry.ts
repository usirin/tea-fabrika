// Part 2, design A: a program whose only job is to bump ./shared-probe.ts, sent as its own module.
import {WorkerEntrypoint} from "cloudflare:workers";
import {bump} from "./shared-probe.ts";

const born = Date.now();

export class Program extends WorkerEntrypoint<any> {
	bump() {
		return {n: bump(), born};
	}
	isolate() {
		return {calls: bump(), born};
	}
}

export default {
	fetch() {
		return new Response("a probe of shared module state");
	},
};
