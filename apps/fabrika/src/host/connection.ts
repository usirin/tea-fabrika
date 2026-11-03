// Which ledger a home's host uses, and who it writes as. A home with no `ledger.json` keeps its own
// node:sqlite file, as before, and the one person at the window is "owner". A home that was
// connected to a ledger server (`fabrika connect <url>`) logs in there with the person's SSH key
// each time its host starts, and writes as the person the door says it is.
//
//   yield* connect(home, {address: "https://ledger.example.com/acme", login: "alice", key})
//   // the door checks a signature from `key` against the keys GitHub lists for alice; then
//   // <home>/ledger.json: {"url": "https://ledger.example.com", "ledger": "acme", "login": "alice", "key": ...}
//   yield* invite(home, "bob")            // alice's session invites bob; he gets in at his first login
//   Layer.build(hostLedger(home))         // Ledger over HTTP, Author {kind: "user", id: "github:7"}
//
// `fabrika connect` is `connectAndRestart`: the same, then the home's running host is stopped by
// its pid. An app that runs sees its link end and starts a host again, as after any lost link,
// and that host reads the new file. Nothing for the person to do. What a stop costs is what the
// window's restart costs: each tile's running jobs stop, and `attach %n` brings each back.
//
// No session is kept on disk: the file names the key, never a token, and a session is short
// (the door's `SESSION_MS`, 4 hours). A host logs in when it starts, and keeps its session
// renewed while it runs (`renewing`): again 5 minutes before the end, and on any 401, as after
// a laptop slept past it. A person the door no longer lets in is a failure of every call, with
// the door's why, and no more logins.
//
// One project, one server: the file picks either the home's own file or a server, never both
// (docs/direction/the-ledger-goes-to-cloudflare.md).

import {type Ledger, layerSignerFile} from "@kampus/fabrika-old";
import {DoorRefused, doorOf, layerHttp, renewing} from "@kampus/fabrika-old/http";
import {layerSqliteSync} from "@kampus/fabrika-old/sqlite";
import {Author} from "@tea-fabrika/tracker";
import {Effect, FileSystem, Layer, Option, Path, Schema} from "effect";
import {stopHost} from "./stop.ts";

/** The file in a home that says which ledger server it is connected to. */
export const CONNECTION_FILE = "ledger.json";

/** The one person at a home that is connected to no server. */
export const OWNER = {kind: "user", id: "owner"} as const;

/** A server's base URL: `http(s)://host[:port]`, no path. */
const Base = Schema.String.check(Schema.isPattern(/^https?:\/\/[^/\s?#]+$/));
/** An object's name on the server: the address's one path part. */
const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/));

/** What `ledger.json` holds: where the server is, who logs in, and with which key file. */
export const Connection = Schema.Struct({
	url: Base,
	ledger: Name,
	login: Schema.String.check(Schema.isPattern(/^\S{1,100}$/)),
	key: Schema.String.check(Schema.isMinLength(1)),
});
export type Connection = typeof Connection.Type;

/** The connection could not be made or read; `why` in words. */
export class ConnectFailed extends Schema.TaggedError<ConnectFailed>()("ConnectFailed", {
	why: Schema.String,
}) {}

/** `https://ledger.example.com/acme` as the server's base and the ledger's name, or why not. */
export const addressOf = (address: string) => {
	const m = /^(https?:\/\/[^/\s?#]+)\/([^/\s?#]+)\/?$/.exec(address.trim());
	const url = m?.[1];
	const ledger = m?.[2];
	return url !== undefined && ledger !== undefined && Schema.is(Name)(ledger)
		? Effect.succeed({url, ledger})
		: Effect.fail(
				new ConnectFailed({
					why: `${address} is not a ledger's address: it is the server's URL, then one name, as https://ledger.example.com/acme`,
				}),
			);
};

const fileOf = (home: string) =>
	Effect.gen(function* () {
		return (yield* Path.Path).join(home, CONNECTION_FILE);
	});

const decodeConnection = Schema.decodeUnknownEffect(Schema.fromJsonString(Connection));

/** The home's connection, or none: the home keeps its own file. */
export const connectionOf = (home: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const file = yield* fileOf(home);
		if (!(yield* fs.exists(file))) return Option.none<Connection>();
		const text = yield* fs.readFileString(file);
		return Option.some(
			yield* decodeConnection(text).pipe(
				Effect.mapError(() => new ConnectFailed({why: `${file} does not read as a connection`})),
			),
		);
	}).pipe(
		Effect.catchTag("PlatformError", (e) =>
			Effect.fail(new ConnectFailed({why: `the connection could not be read: ${e.message}`})),
		),
	);

/** A fresh session on `c`'s server, signed with its key file. */
export const loginWith = (c: Connection) =>
	doorOf({url: c.url, ledger: c.ledger})
		.login(c.login)
		.pipe(Effect.provide(layerSignerFile(c.key)));

/**
 * Connect a home to a ledger server: log in there as `login`, with the SSH key file `key`, and
 * keep the connection in the home for its host. Refused by the door, nothing is kept. Answers who
 * the door says this person is.
 */
export const connect = (
	home: string,
	o: {readonly address: string; readonly login: string; readonly key: string},
) =>
	Effect.gen(function* () {
		const {url, ledger} = yield* addressOf(o.address);
		const c: Connection = {url, ledger, login: o.login, key: o.key};
		const session = yield* loginWith(c);
		yield* keepConnection(home, c);
		return session.who;
	});

/**
 * `connect`, then stop the home's running host (host/stop.ts), as the window's "Stop the old host"
 * does. A running app sees its link end, and its reconnect (reconnect.ts) starts a host again,
 * which reads the new `ledger.json`. Answers who the door says this person is, and what came of
 * the host: `stopped`, `none` (none ran: the next start uses it), or why it did not stop.
 */
export const connectAndRestart = (
	home: string,
	o: {readonly address: string; readonly login: string; readonly key: string},
) =>
	Effect.gen(function* () {
		const who = yield* connect(home, o);
		const host = yield* stopHost(home).pipe(
			Effect.catchTag("NotStopped", (e) => Effect.succeed({kind: "running", why: e.why} as const)),
		);
		return {who, host};
	});

/** Keep `c` in the home: its host uses that server from its next start. */
export const keepConnection = (home: string, c: Connection) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(home, {recursive: true, mode: 0o700});
		const file = yield* fileOf(home);
		yield* fs.writeFileString(file, `${JSON.stringify(c, null, "\t")}\n`, {mode: 0o600});
	}).pipe(
		Effect.catchTag("PlatformError", (e) =>
			Effect.fail(new ConnectFailed({why: `the connection could not be kept: ${e.message}`})),
		),
	);

/** The connection of a home that must have one. */
const connected = (home: string) =>
	Effect.flatMap(connectionOf(home), (c) =>
		Option.match(c, {
			onNone: () =>
				Effect.fail(
					new ConnectFailed({why: "this home is connected to no ledger: fabrika connect <url>"}),
				),
			onSome: Effect.succeed,
		}),
	);

/** The home's person invites `login` to its ledger. They get in at their first login. */
export const invite = (home: string, login: string) =>
	Effect.gen(function* () {
		const c = yield* connected(home);
		const session = yield* loginWith(c);
		return yield* doorOf({url: c.url, ledger: c.ledger}).invite(session.token, login);
	});

/** Who is on the home's ledger, and who is invited and has not come yet. */
export const members = (home: string) =>
	Effect.gen(function* () {
		const c = yield* connected(home);
		const session = yield* loginWith(c);
		return yield* doorOf({url: c.url, ledger: c.ledger}).members(session.token);
	});

/**
 * The host's ledger and who it writes as: the home's own file and the owner, or the connected
 * server and the person its door let in. A refused login fails the host's start, with why.
 */
export const hostLedger = (
	home: string,
): Layer.Layer<Ledger | Author, ConnectFailed | DoorRefused, FileSystem.FileSystem | Path.Path> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const c = yield* connectionOf(home);
			if (Option.isNone(c)) {
				const path = yield* Path.Path;
				return Layer.merge(
					layerSqliteSync({path: path.join(home, "ledger.sqlite"), tickMs: 1000}),
					Layer.succeed(Author, OWNER),
				);
			}
			const first = yield* loginWith(c.value).pipe(
				Effect.catchTag("KeyUnreadable", (e) =>
					Effect.fail(new ConnectFailed({why: `the key ${e.path}: ${e.why}`})),
				),
			);
			// Later logins: a key file that cannot be read for a moment is tried again, as the network.
			const again = loginWith(c.value).pipe(
				Effect.catchTag("KeyUnreadable", (e) =>
					Effect.fail(new DoorRefused({status: 0, why: `the key ${e.path}: ${e.why}`})),
				),
				Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem),
			);
			const session = yield* renewing(first, again);
			return Layer.merge(
				layerHttp({url: c.value.url, ledger: c.value.ledger, token: session}),
				Layer.succeed(Author, first.who),
			);
		}),
	);

export {DoorRefused};
