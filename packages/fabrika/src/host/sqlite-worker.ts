// One worker thread of `./sqlite`: its own connection to the one file, answering calls posted to it.
// Node at the edge: a worker thread is how one process holds several SQLite connections at once, so
// the threads race for SQLite's write lock as separate hosts would.
import {parentPort, workerData} from "node:worker_threads";
import * as L from "./rules.ts";
import {dispatch, type Method, openDb} from "./sqlite-driver.ts";

/** `now`: the time the layer's clock gave the call, so every thread runs on that one clock. */
type Call = {id: number; method: Method; args: unknown[]; now: number};

const port = parentPort;
if (port !== null) {
	const {db} = openDb(String(workerData.path));
	const graceMs = Number(workerData.graceMs ?? 1000);
	const max: unknown = workerData.maxDeliveries;
	const maxDeliveries = max === null ? null : Number(max ?? L.MAX_DELIVERIES);
	port.on("message", (c: Call) => {
		try {
			const ok = dispatch(db, L.RULES, graceMs, c.now, c.method, c.args, maxDeliveries);
			port.postMessage({id: c.id, ok});
		} catch (e) {
			port.postMessage({id: c.id, error: e instanceof Error ? e.message : String(e)});
		}
	});
}
