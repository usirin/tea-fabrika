// Miniflare's options for the ledger's Durable Object: the Worker, bundled by esbuild from
// `durable-object.ts` and what it imports (`effect` too: workerd has no node_modules to find it
// in), and the SQLite-backed object. Lifted from experiment 97 (experiments/97-one-ledger/worker.ts).
// Used by the local daemon, and by a test or a script that runs Miniflare in its own process. From
// the build the files are `.js`, and esbuild bundles those the same way.
//
// The door (`door.ts`) is picked here. With no `door`, the ledger's HTTP face refuses every
// request, and only code holding the binding reaches it (`inside.ts`, for tests).
//
// Node at the edge: esbuild's Node API, loaded with Node's `require` when the options are made (an
// optional peer: `@kampus/fabrika/local` still loads without it), and node:crypto's SHA-256 (the
// door keeps a hash of the local secret, never the secret).
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {Redacted} from "effect";
import type * as Esbuild from "esbuild";
import {beside} from "./beside.ts";

/**
 * The Worker as one module: the Durable Object, its rules, the door, the SSH signatures it checks
 * and the `Keys` Layers. `cloudflare:*` is workerd's own, so it stays an import.
 */
const modules = () => {
	const {buildSync}: typeof Esbuild = createRequire(import.meta.url)("esbuild");
	const entry = beside(import.meta.url, "durable-object");
	const out = buildSync({
		entryPoints: [entry],
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2023",
		external: ["cloudflare:*"],
		write: false,
		logLevel: "silent",
	});
	return [{type: "ESModule" as const, path: entry, contents: out.outputFiles[0]?.text ?? ""}];
};

/** Where a shared door's keys come from. Only GitHub's today (`keys-github.ts`). */
export type KeysOptions = {
	readonly kind: "github";
	/** How long GitHub's answers are kept, in ms. Default `KEYS_CACHE_MS`, 5 minutes. */
	readonly cacheMs?: number;
	/**
	 * A GitHub token, for the ledger's own budget of calls (5,000 an hour, not the 60 its address
	 * shares). The Worker gets it as the `GITHUB_TOKEN` binding, a secret on Cloudflare. Left out:
	 * GitHub is asked with no token.
	 */
	readonly token?: Redacted.Redacted<string>;
	/** Where the ledger's calls to api.github.com go instead (a fake, in tests); left out, GitHub. */
	readonly api?: (req: Request) => Promise<Response>;
};

/** Which door the ledger has. */
export type DoorOptions =
	/** One laptop: `person` is who every request with `secret` is. */
	| {readonly kind: "local"; readonly person: string; readonly secret: Redacted.Redacted<string>}
	/**
	 * A shared ledger: members on the ledger, SSH proof against the keys `keys` names. `founder`:
	 * the id of the person who made it, as that keys service gives it (`github:<n>`). `origin`:
	 * the server's public origin, which challenges and grants name before the object's name
	 * (default: the request's own origin). `sessionMs`: how long a person's session lasts
	 * (door.ts: `SESSION_MS`, 4 hours, when left out).
	 */
	| {
			readonly kind: "shared";
			readonly founder: string;
			readonly origin?: string;
			readonly sessionMs?: number;
			readonly keys: KeysOptions;
	  };

export interface LedgerOptions {
	/** The data folder, or `false`: in memory. */
	readonly persist: string | false;
	/** How long after a lease's end its `lease_expired` may wait. Default 1000 ms. */
	readonly graceMs?: number;
	/** Crashes in a row on one message before it goes to `<name>/dead`; `null`: never. Default 3. */
	readonly maxDeliveries?: number | null;
	/** Serve on workerd's own socket at this port (0 picks one). */
	readonly direct?: number;
	/** The door. Left out: the HTTP face is closed. */
	readonly door?: DoorOptions;
}

const doorBindings = (d: DoorOptions | undefined): Record<string, string> =>
	d === undefined
		? {}
		: d.kind === "local"
			? {
					DOOR: "local",
					LOCAL_PERSON: d.person,
					LOCAL_SECRET_HASH: createHash("sha256").update(Redacted.value(d.secret)).digest("hex"),
				}
			: {
					DOOR: "shared",
					FOUNDER: d.founder,
					...(d.origin === undefined ? {} : {ORIGIN: d.origin}),
					...(d.sessionMs === undefined ? {} : {SESSION_MS: String(d.sessionMs)}),
					KEYS: d.keys.kind,
					...(d.keys.cacheMs === undefined ? {} : {KEYS_CACHE_MS: String(d.keys.cacheMs)}),
					...(d.keys.token === undefined ? {} : {GITHUB_TOKEN: Redacted.value(d.keys.token)}),
				};

/**
 * The options `new Miniflare(...)` takes, typed by what is in them. Miniflare is an optional peer,
 * and its declarations do not pass `skipLibCheck: false`, so this package's declarations never name
 * them (experiment 108). `daemon.ts` hands these to `new Miniflare`, which checks them.
 */
export const ledgerOptions = (o: LedgerOptions) => ({
	modules: modules(),
	modulesRoot: fileURLToPath(new URL(".", import.meta.url)),
	compatibilityDate: "2026-07-01",
	durableObjects: {LEDGER: {className: "Ledger", useSQLite: true}},
	durableObjectsPersist: o.persist,
	bindings: {
		EXPIRY_GRACE_MS: String(o.graceMs ?? 1000),
		...(o.maxDeliveries === undefined
			? {}
			: {MAX_DELIVERIES: o.maxDeliveries === null ? "off" : String(o.maxDeliveries)}),
		...doorBindings(o.door),
	},
	// Miniflare sends the Worker's own outgoing `fetch` here, so a test's GitHub is a fake.
	...(o.door?.kind === "shared" && o.door.keys.api !== undefined
		? {outboundService: o.door.keys.api}
		: {}),
	host: "127.0.0.1",
	...(o.direct === undefined ? {} : {unsafeDirectSockets: [{host: "127.0.0.1", port: o.direct}]}),
});
