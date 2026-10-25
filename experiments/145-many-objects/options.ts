// Miniflare's options for experiment 145's server: `server.ts` and `session.ts`, next to the
// package's own Durable Object and its rules, all with their types stripped, in one folder of
// modules. The package's two files come from `ledgerOptions`, the options the package's own local
// ledger starts with, so the server runs exactly the package's ledger code.
//
// Node at the edge: reading the files, and Node's type stripper.
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {basename, join} from "node:path";
import {fileURLToPath} from "node:url";
import {ledgerOptions} from "@kampus/fabrika/local";

const here = fileURLToPath(new URL(".", import.meta.url));

const own = (name: string) => {
	const path = join(here, `${name}.ts`);
	return {
		type: "ESModule" as const,
		path,
		contents: stripTypeScriptTypes(readFileSync(path, "utf8")),
	};
};

export interface ServerOptions {
	/** The data folder, or `false`: in memory. */
	readonly persist: string | false;
	/** Signs every session. */
	readonly secret: string;
	/** The operator's id, `github:<n>`: creates projects and moves the server. */
	readonly operator: string;
	/** Planted mistakes, by name (`PLANTED` in `router.ts`), comma-separated. */
	readonly planted?: string;
	/** workerd's own socket's port; 0 picks a free one. */
	readonly port: number;
}

export const serverOptions = (o: ServerOptions) => {
	const pkg = ledgerOptions({persist: o.persist});
	return {
		// The first module is the Worker; the package's two keep their names, `durable-object.ts`
		// and `rules.ts`, in this folder, where `server.ts` imports them.
		modules: [
			own("server"),
			own("router"),
			own("session"),
			...pkg.modules.map((m) => ({...m, path: join(here, basename(m.path))})),
		],
		modulesRoot: here,
		compatibilityDate: pkg.compatibilityDate,
		durableObjects: {
			PROJECT: {className: "Project", useSQLite: true},
			PERSON: {className: "Person", useSQLite: true},
			LANE: {className: "Lane", useSQLite: true},
			INDEX: {className: "Index", useSQLite: true},
		},
		durableObjectsPersist: o.persist,
		bindings: {
			...pkg.bindings,
			SECRET: o.secret,
			OPERATOR: o.operator,
			PLANTED: o.planted ?? "",
		},
		host: "127.0.0.1",
		unsafeDirectSockets: [{host: "127.0.0.1", port: o.port}],
	};
};
