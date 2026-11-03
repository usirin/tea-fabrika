import {Ledger, Shell, Traces} from "@kampus/fabrika-old";
import {type InTile, type JobAnswer, serveAgent} from "@kampus/fabrika-old/mcp";
import {Author, PullRequests} from "@tea-fabrika/tracker";
import {Effect, type Scope} from "effect";
import type {SocketServer} from "effect/socket";
import {appPrograms} from "../tsh.ts";

// The host's agents' socket, `<home>/host/mcp`: each agent's MCP bridge attaches here (the app's
// `fabrika mcp --as <name>`), and is served the app's programs as tools (`@kampus/fabrika-old/mcp`).
// It names no platform: host/run.ts makes the server on the socket file, a test on its own.
//
//   person's tile    tsh$ tracker                     the tracker, as user:owner
//   agent's chat     tracker_file {value: {title: "Login fails", body: ""}}
//                    the agent's own tracker files #1, as agent:claude for:owner
//   person's tile    #1 shows on the list within a second: the tile's tracker polls the ledger
//
// Each agent gets its own run of a program, never the run in a tile: the run in a tile writes as
// the person. Its writer is the agent the handshake named, for the host's person; `appPrograms` packs
// every program with that writer, the same function a tile's tsh packs them with as the person.
// So an agent's tool call has no path to the person's writer. An agent has no `tracker_answer`
// at all: the tracker's `answer` is an input only a person tells (`{personOnly: true}`), so no
// tool is made for it. Behind that, the tracker still refuses an agent's `answered` as it refuses
// any agent's (programs/tracker, `mayWrite`).
//
// Beside `runs`, the host's own `job` tool: one job of the host's table, its state and its last
// lines (`job`, job-lines.ts), as tmux's `capture-pane` reads a pane.
//
//   agent's chat     job {n: 1, last: 2}
//                    {n: 1, text: "seq --to 5", tile: "t1", state: {_tag: "ended", how: "done"}, lines: ["4", "5"]}
//
// Every home has the socket. On a home that keeps its own ledger file, every tool. On a home
// connected to a ledger server (`readOnly`), only the tools that write nothing: there the host's
// ledger is the person's session, and the server's door stamps what it writes as the person
// whatever the tracker names, so an agent's write would be credited to the person. A write tool is
// not listed there, and one called anyway is refused before any run starts. A write there needs
// the agent's own session (host/post.ts, `asAgent`), not built yet. Starting or stopping a lane
// stays the person's, in a tile.

/** A screen's port name, `run:<id>`, as a run in a tile; a run's id starts with its program's name. */
const inTile = (port: string): InTile | null => {
	if (!port.startsWith("run:")) return null;
	const run = port.slice("run:".length);
	const at = run.indexOf(":");
	return {run, program: at === -1 ? run : run.slice(0, at)};
};

/** Serve every agent that attaches to `server`, until the host stops. */
export const serveAgents = (options: {
	readonly server: SocketServer.SocketServer["Service"];
	/** The screens' names now. */
	readonly ports: () => Iterable<string>;
	/**
	 * Said with each agent's name once its handshake is read, in the agent's scope: the host lists
	 * who is attached by it, for the top bar's agents (host/serve.ts).
	 */
	readonly attached: (name: string) => Effect.Effect<void, never, Scope.Scope>;
	/** Job n of the host's table now, with its lines (job-lines.ts), for the `job` tool. */
	readonly job: (n: number) => JobAnswer | null;
	/** Only the tools that write nothing: a home connected to a ledger server. */
	readonly readOnly: boolean;
}) =>
	Effect.gen(function* () {
		const {server, ports, attached, job, readOnly} = options;
		const ledger = yield* Ledger;
		const person = yield* Author;
		const pullRequests = yield* PullRequests;
		const traces = yield* Traces;
		return yield* server.run((socket) =>
			serveAgent(socket, {
				person: person.id,
				programsFor: (who) => Shell.programList(appPrograms(ledger, who, pullRequests, traces)),
				tiles: () => [...ports()].flatMap((port) => inTile(port) ?? []),
				job,
				readOnly,
				attached: (who) => attached(who.id),
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("fabrika host: an agent's link failed", cause),
				),
				Effect.andThen(Effect.logDebug("fabrika host: an agent went")),
			),
		);
	});
