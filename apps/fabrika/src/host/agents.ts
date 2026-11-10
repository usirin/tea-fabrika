import {Ledger, Shell, Traces} from "@kampus/fabrika-old";
import {type AgentOptions, type InTile, type JobAnswer, serveAgent} from "@kampus/fabrika-old/mcp";
import {Author, PullRequests, RepoTree} from "@tea-fabrika/tracker";
import {Context, Effect, type Scope} from "effect";
import type {SocketServer} from "effect/socket";
import {appPrograms} from "../tsh.ts";
import type {AgentSessions} from "./agent-session.ts";

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
// at all: the tracker's `answer` is an input only a person tells (`{personOnly: true}`), and the
// door is handed `forAgent` of the list, so its programs have no such input, and no tool is made
// for one. Behind that, the tracker still refuses an agent's `answered` as it refuses any
// agent's (programs/tracker, `mayWrite`).
//
// Beside `runs`, the host's own `job` tool: one job of the host's table, its state and its last
// lines (`job`, job-lines.ts), as tmux's `capture-pane` reads a pane.
//
//   agent's chat     job {n: 1, last: 2}
//                    {n: 1, text: "seq --to 5", tile: "t1", state: {_tag: "ended", how: "done"}, lines: ["4", "5"]}
//
// And its `stop` tool: an agent stops a job of the host's table, the person's too, and must say
// why (the owner's call, tracker 185). The tile the job ran in says who and why, and its record
// and the host's log keep the agent (host/serve.ts, `stopFor`).
//
//   agent's chat     stop {n: 1, why: "wrong ticket"}
//                    {_tag: "stopped", job: {n: 1, ..., state: {_tag: "ended", how: "stopped"}}}
//   person's tile    [1] stopped by agent:claude for:owner: wrong ticket
//
// And its `restart` tool: an agent restarts the host, and must say why. The host answers, leaves
// its note for the next host (host/restart.ts), and ends; the app attached starts the next one, so
// with no app attached it is refused (host/serve.ts, `restartFor`).
//
//   agent's chat     restart {why: "pick up the new build"}
//                    {_tag: "restarting", detached: [2]}
//   person's tile    tsh: 1 job from an earlier tsh, restarted by agent:claude for:owner, not running: %2. ...
//
// And its `line` tool: an agent runs one line in its own tile, which its first line opens beside
// the person's, and whose tsh runs as the agent (host/serve.ts, `lineFor`; tiles.ts).
//
//   agent's chat     line {line: "tally &"}
//                    {_tag: "job", job: {n: 2, text: "tally &", tile: "t2", state: {_tag: "running"}, lines: []}}
//   agent's tile     $ tally &
//
// Every home has the socket, and every agent gets every tool. On a home that keeps its own ledger
// file, an agent's programs write on the host's ledger, as the agent. On a home connected to a
// ledger server, each agent writes on its own session (`sessionFor`, host/agent-session.ts): the
// server's door stamps what it writes `agent:<name>` for the person, never as the person.
//
//   agent attaches   its session, made as its handshake is read, kept while the agent stays
//   host/log         message=agent_session agent=claude expires=1767225600000
//
// An agent whose session could not be made gets the read-only door, never the person's session:
// only the tools that write nothing are listed, a write tool called anyway is refused before any
// run starts, and `runs` says why (`@kampus/fabrika-old/mcp`, drive.ts).
//
//   host/log         message=agent_refused agent=claude "why=the key .../agent_ed25519: ..."
//
// Starting a lane stays the person's, in a tile.

/** A screen's port name, `run:<id>`, as a run in a tile; a run's id starts with its program's name. */
const inTile = (port: string): InTile | null => {
	if (!port.startsWith("run:")) {
		return null;
	}

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
	/** Stop job n for an agent, and why (host/serve.ts), for the `stop` tool. */
	readonly stop: NonNullable<AgentOptions["stop"]>;
	/** Restart the host for an agent, and why (host/serve.ts), for the `restart` tool; none, no tool. */
	readonly restart?: AgentOptions["restart"];
	/** Run one line in an agent's own tile (host/serve.ts), for the `line` tool. */
	readonly line: NonNullable<AgentOptions["line"]>;
	/**
	 * Agent `name`'s own session on the home's ledger server, held in the agent's scope
	 * (host/agent-session.ts); `null`: the home keeps its own ledger file, and each agent writes on
	 * the host's.
	 */
	readonly sessionFor: AgentSessions | null;
}) =>
	Effect.gen(function* () {
		const {server, ports, attached, job, stop, restart, line, sessionFor} = options;
		const ledger = yield* Ledger;
		const person = yield* Author;
		const pullRequests = yield* PullRequests;
		const repoTree = yield* RepoTree;
		const traces = yield* Traces;
		/** An agent's list: the app's programs as `who` writes, with every person-only input taken out. */
		const listOn = (on: Ledger["Service"], who: Author["Service"]) =>
			Shell.forAgent(Shell.programList(appPrograms(on, who, pullRequests, traces, repoTree)));
		/** What agent `who` is served: its own session's programs, or the read-only door, with why. */
		const programsFor: AgentOptions["programsFor"] = (who) =>
			sessionFor === null
				? Effect.succeed({list: listOn(ledger, who), readOnly: null})
				: sessionFor(who.id).pipe(
						Effect.map((session) => ({
							list: listOn(Context.get(session, Ledger), Context.get(session, Author)),
							readOnly: null,
						})),
						Effect.catchTag("ConnectFailed", ({why}) =>
							Effect.logWarning("agent_refused").pipe(
								Effect.annotateLogs({agent: who.id, why}),
								Effect.as({list: listOn(ledger, who), readOnly: {why}}),
							),
						),
					);
		return yield* server.run((socket) =>
			serveAgent(socket, {
				person: person.id,
				programsFor,
				tiles: () => [...ports()].flatMap((port) => inTile(port) ?? []),
				job,
				stop,
				restart,
				line,
				attached: (who) => attached(who.id),
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("fabrika host: an agent's link failed", cause),
				),
				Effect.andThen(Effect.logDebug("fabrika host: an agent went")),
			),
		);
	});
