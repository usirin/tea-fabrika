// Miniflare's options for the ledger's Durable Object: the worker's files, types stripped by Node's
// own stripper (no bundler), and the SQLite-backed object. Lifted from experiment 97
// (experiments/97-one-ledger/worker.ts). Used by the local daemon, and by a test or a script that
// runs Miniflare in its own process. From the build the files are `.js` already, and stripping
// leaves them as they are.
//
// The door (`door.ts`) is picked here. With no `door`, the ledger's HTTP face refuses every
// request, and only code holding the binding reaches it (`inside.ts`, for tests).
//
// Node at the edge: reading the files, Node's type stripper, and node:crypto's SHA-256 (the door
// keeps a hash of the local secret, never the secret).
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {fileURLToPath} from "node:url";
import {Redacted} from "effect";
import {beside} from "./beside.ts";

/** The worker's modules: the Durable Object, its rules, the door and the SSH signatures it checks. */
const modules = () =>
	["durable-object", "rules", "door", "sshsig"].map((name) => ({
		type: "ESModule" as const,
		path: beside(import.meta.url, name),
		contents: stripTypeScriptTypes(readFileSync(beside(import.meta.url, name), "utf8")),
	}));

/** Which door the ledger has. */
export type DoorOptions =
	/** One laptop: `person` is who every request with `secret` is. */
	| {readonly kind: "local"; readonly person: string; readonly secret: Redacted.Redacted<string>}
	/**
	 * A shared ledger: members on the ledger, SSH proof against GitHub. `founder`: GitHub's numeric
	 * id of the person who made it. `origin`: the server's public origin, which challenges and
	 * grants name before the object's name (default: the request's own origin). `github`: where the ledger's calls to
	 * api.github.com go instead (a fake, in tests); left out, they go to GitHub. `sessionMs` and
	 * `keysCacheMs`: how long a person's session lasts, and how long the door keeps a login's keys
	 * from GitHub (door.ts: `SESSION_MS`, 4 hours, and `KEYS_CACHE_MS`, 5 minutes, when left out).
	 */
	| {
			readonly kind: "github";
			readonly founder: number;
			readonly origin?: string;
			readonly sessionMs?: number;
			readonly keysCacheMs?: number;
			readonly github?: (req: Request) => Promise<Response>;
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
					DOOR: "github",
					FOUNDER: String(d.founder),
					...(d.origin === undefined ? {} : {ORIGIN: d.origin}),
					...(d.sessionMs === undefined ? {} : {SESSION_MS: String(d.sessionMs)}),
					...(d.keysCacheMs === undefined ? {} : {KEYS_CACHE_MS: String(d.keysCacheMs)}),
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
	...(o.door?.kind === "github" && o.door.github !== undefined
		? {outboundService: o.door.github}
		: {}),
	host: "127.0.0.1",
	...(o.direct === undefined ? {} : {unsafeDirectSockets: [{host: "127.0.0.1", port: o.direct}]}),
});
