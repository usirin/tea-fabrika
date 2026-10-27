import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {Effect, FileSystem, Layer, Path, Schema, Scope} from "effect";
import {SocketServer} from "effect/socket";
import {fileHistory, sharedHistory} from "../editor/history.ts";
import {hostLedger} from "./connection.ts";
import {holdLock} from "./lock.ts";
import {serve} from "./serve.ts";
import {pathsOf, reach} from "./socket.ts";

// The host on a home: its socket, its files and its services, around the server (serve.ts).
// host/main.ts runs it as a process of its own; a test runs it in its own process, on a home of
// its own (host.test.ts). Node is named only through Effect's platform: `NodeSocketServer`, and
// the ledger's node:sqlite and the storage's files from @kampus/fabrika.
//
//   yield* runHost({home, pid: process.pid})
//   // <home>/host made, mode 0700; the start lock taken (host/lock.ts); a socket left by a crash
//   // removed; <home>/host/sock listened on, mode 0600; the pid written; the lock let go of; the
//   // desk read back from desk.json; until the scope closes
//
// In the home, beside the host's own folder (host/socket.ts):
//
//   desk.json            the desk's tiles, kept on each change, for the next start
//   storage/tiles/<t>/   tile <t>'s tsh: its job table and its jobs, as the terminal tsh keeps them
//   history              the line editor's history, one for every tile
//   ledger.sqlite        the ledger, when the home is connected to no server
//   ledger.json          the ledger server it is connected to, if any (connection.ts)
//
// One host per home: a host that finds another answering on the socket does not start, and
// hosts started at the same moment take turns under the start lock, so exactly one listens. The
// ledger and who the host writes as are `hostLedger`'s: with no `ledger.json`, one node:sqlite
// connection in this thread (`layerSqliteSync`: the bundle has no worker file beside it), its
// alarm looking for due jobs once a second, and the owner; connected, the server over HTTP and
// the person its door let in.

/** Another host answers on this home's socket already. */
export class HostAnswers extends Schema.TaggedError<HostAnswers>()("HostAnswers", {
	sock: Schema.String,
}) {}

export const runHost = (options: {
	readonly home: string;
	/** The host's pid, written for a test to stop its own host by. */
	readonly pid: number;
	/** The link's version this host speaks, for a test of an old host. */
	readonly ours?: number | undefined;
	/** The build this host's hello names, for a test of an older host; `null` names none. */
	readonly build?: string | null | undefined;
}) =>
	Effect.gen(function* () {
		const {home, pid, ours, build} = options;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const paths = yield* pathsOf(home);
		const outer = yield* Effect.scope;
		yield* fs.makeDirectory(paths.dir, {recursive: true, mode: 0o700});
		// A folder made before, by hand or by an older build, gets the narrow mode too.
		yield* fs.chmod(paths.dir, 0o700);
		// Under the start lock (host/lock.ts), from the look at the socket until this host listens
		// on it: a host started at the same moment waits, then finds this one answering.
		const server = yield* Effect.scoped(
			Effect.gen(function* () {
				yield* holdLock(paths.lock, paths.dir);
				const found = yield* reach(paths.sock);
				if (found === "live") return yield* new HostAnswers({sock: paths.sock});
				if (found === "stale") yield* fs.remove(paths.sock);
				const made = yield* NodeSocketServer.make({path: paths.sock}).pipe(Scope.provide(outer));
				yield* fs.chmod(paths.sock, 0o600);
				yield* fs.writeFileString(paths.pid, `${pid}\n`);
				return made;
			}),
		);
		// The pid goes while this host still listens, so it never removes the pid of a host
		// started after it. The socket's own file goes as the server closes: Node removes it
		// before it lets go of the socket (libuv's `uv__pipe_close`), so this host never removes
		// a socket another host listens on.
		yield* Effect.addFinalizer(() => fs.remove(paths.pid).pipe(Effect.ignore));

		const at = (...names: string[]) => path.join(home, ...names);
		const ledger = yield* Layer.build(hostLedger(home));
		const history = yield* sharedHistory(yield* fileHistory(at("history")));
		const kept = yield* fs.readFileString(at("desk.json")).pipe(
			Effect.flatMap((text) => Effect.try(() => JSON.parse(text))),
			Effect.orElseSucceed((): unknown => null),
		);
		yield* Effect.logInfo(`fabrika host: listening, pid ${pid}`);
		return yield* serve({
			history,
			ours,
			build,
			place: (tile) => ({
				jobs: fileStorage(at("storage", "tiles", tile)),
				drop: fs.remove(at("storage", "tiles", tile), {recursive: true}).pipe(Effect.ignore),
			}),
			desk: {
				kept,
				save: (saved) =>
					fs
						.writeFileString(at("desk.json"), JSON.stringify(saved))
						.pipe(
							Effect.catch((e) =>
								Effect.logError(`fabrika host: could not keep the desk: ${e.message}`),
							),
						),
				forget: fs.remove(at("desk.json")).pipe(Effect.ignore),
			},
		}).pipe(
			Effect.provideService(SocketServer.SocketServer, server),
			Effect.provideContext(ledger),
		);
	});
