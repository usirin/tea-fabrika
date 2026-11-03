// One project's ledger server, as config: what both the deploy (`stack.ts`) and the twin
// (`twin.ts`) are made from. docs/direction/the-ledger-goes-to-cloudflare.md decided one Worker per
// project, its name the project's pick, and the founder set by whoever makes the ledger.
//
//   const config = decodeConfig({name: "acme-ledger", founder: "github:7"})
//   serverDoor(config)
//   // {kind: "shared", founder: "github:7", keys: {kind: "github"}}
//   ledgerBindings({door: serverDoor(config)})
//   // {EXPIRY_GRACE_MS: "1000", DOOR: "shared", FOUNDER: "github:7", KEYS: "github"}
//
// The server is fabrika's own Worker and Durable Object (`LEDGER_ENTRY`), unchanged. What differs
// between Cloudflare and the laptop is only where it runs and, in a test, where its calls to GitHub
// go. Everything else comes from here.
import type {DoorOptions} from "@kampus/fabrika-old/local";
import {Schema} from "effect";

/** A Worker's name on Cloudflare: lower case, digits and dashes, up to 63. */
const WorkerName = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/));
/** A person's id on GitHub's keys service: `github:<GitHub's numeric user id>`. */
const GitHubId = Schema.String.check(Schema.isPattern(/^github:[1-9][0-9]{0,19}$/));
/** A public origin, `https://host`, with no path. */
const Origin = Schema.String.check(Schema.isPattern(/^https?:\/\/[^/\s]+$/));

export const ServerConfig = Schema.Struct({
	/** The project's Worker: `[ledger] name` in its fabrika.toml. A new name is a new, empty server. */
	name: WorkerName,
	/** Who made the ledger: its first member, by id. The first login by that id writes `founded`. */
	founder: GitHubId,
	/** The server's public origin, which challenges and grants name. Left out: each request's own. */
	origin: Schema.optional(Origin),
});
export type ServerConfig = typeof ServerConfig.Type;

export const decodeConfig = Schema.decodeUnknownSync(ServerConfig);

/** The door a project's server has: shared, its keys from GitHub, its founder from config. */
export const serverDoor = (c: ServerConfig): Extract<DoorOptions, {kind: "shared"}> => ({
	kind: "shared",
	founder: c.founder,
	...(c.origin === undefined ? {} : {origin: c.origin}),
	keys: {kind: "github"},
});
