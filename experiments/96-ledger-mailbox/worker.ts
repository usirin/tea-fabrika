// Copied from experiments/93-ledger/worker.ts. What changed: it loads this folder's `ledger.ts`
// and `sql.ts`, and can serve on workerd's own socket (`direct`, as experiment 94's daemon did),
// so no request passes through Miniflare's router worker.
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {fileURLToPath} from "node:url";
import type {MiniflareOptions} from "miniflare";

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

/** The two worker files, types stripped by Node's own stripper (no bundler). */
export const ledgerModules = () =>
	["ledger.ts", "sql.ts"].map((name) => ({
		type: "ESModule" as const,
		path: here(name),
		contents: stripTypeScriptTypes(readFileSync(here(name), "utf8")),
	}));

export type LedgerOptions = {
	persist: string | false;
	port?: number;
	graceMs?: number;
	/** Serve on workerd's own socket at this port (0 picks one) instead of Miniflare's. */
	direct?: number;
};

export const ledgerOptions = (o: LedgerOptions): MiniflareOptions => ({
	modules: ledgerModules(),
	modulesRoot: here("."),
	compatibilityDate: "2026-07-01",
	durableObjects: {LEDGER: {className: "Ledger", useSQLite: true}},
	durableObjectsPersist: o.persist,
	bindings: {EXPIRY_GRACE_MS: String(o.graceMs ?? 1000)},
	host: "127.0.0.1",
	...(o.port === undefined ? {} : {port: o.port}),
	...(o.direct === undefined ? {} : {unsafeDirectSockets: [{host: "127.0.0.1", port: o.direct}]}),
});
