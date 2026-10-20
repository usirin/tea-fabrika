// Node side: the Miniflare options that load the Ledger Durable Object. Experiment 95's copy
// of experiment 93's file, unchanged but for this line: it loads the two files beside it.
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

export type LedgerOptions = {persist: string | false; port?: number; graceMs?: number};

export const ledgerOptions = (o: LedgerOptions): MiniflareOptions => ({
	modules: ledgerModules(),
	modulesRoot: here("."),
	compatibilityDate: "2026-07-01",
	durableObjects: {LEDGER: {className: "Ledger", useSQLite: true}},
	durableObjectsPersist: o.persist,
	bindings: {EXPIRY_GRACE_MS: String(o.graceMs ?? 1000)},
	host: "127.0.0.1",
	...(o.port === undefined ? {} : {port: o.port}),
});
