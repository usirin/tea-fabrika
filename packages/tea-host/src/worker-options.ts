// Miniflare's options for the ledger's Durable Object: the two worker files, types stripped by Node's
// own stripper (no bundler), and the SQLite-backed object. Lifted from experiment 97
// (experiments/97-one-ledger/worker.ts). Used by the local daemon, and by a test or a script that
// runs Miniflare in its own process.
//
// Node at the edge: reading the files, and Node's type stripper.
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {fileURLToPath} from "node:url";
import type {MiniflareOptions} from "miniflare";

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

/** The worker's modules: the Durable Object and its rules. */
const modules = () =>
	["durable-object.ts", "rules.ts"].map((name) => ({
		type: "ESModule" as const,
		path: here(name),
		contents: stripTypeScriptTypes(readFileSync(here(name), "utf8")),
	}));

export interface LedgerOptions {
	/** The data folder, or `false`: in memory. */
	readonly persist: string | false;
	/** How long after a lease's end its `lease_expired` may wait. Default 1000 ms. */
	readonly graceMs?: number;
	/** Crashes in a row on one message before it goes to `<name>/dead`; `null`: never. Default 3. */
	readonly maxDeliveries?: number | null;
	/** Serve on workerd's own socket at this port (0 picks one). */
	readonly direct?: number;
}

export const ledgerOptions = (o: LedgerOptions): MiniflareOptions => ({
	modules: modules(),
	modulesRoot: here("."),
	compatibilityDate: "2026-07-01",
	durableObjects: {LEDGER: {className: "Ledger", useSQLite: true}},
	durableObjectsPersist: o.persist,
	bindings: {
		EXPIRY_GRACE_MS: String(o.graceMs ?? 1000),
		...(o.maxDeliveries === undefined
			? {}
			: {MAX_DELIVERIES: o.maxDeliveries === null ? "off" : String(o.maxDeliveries)}),
	},
	host: "127.0.0.1",
	...(o.direct === undefined ? {} : {unsafeDirectSockets: [{host: "127.0.0.1", port: o.direct}]}),
});
