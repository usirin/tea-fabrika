import {createConnection} from "node:net";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import {Ledger, Shell, Traces} from "@kampus/fabrika-old";
import type {AgentOptions} from "@kampus/fabrika-old/mcp";
import {memoryService} from "@kampus/fabrika-old/memory";
import {memoryTraces} from "@tea-fabrika/trace/memory";
import {Author, PullRequests} from "@tea-fabrika/tracker";
import {Context, Effect, FileSystem} from "effect";
import {describe, expect, it, vi} from "vitest";
import {appPrograms} from "../tsh.ts";
import type {AgentSessions} from "./agent-session.ts";
import {serveAgents} from "./agents.ts";
import {ConnectFailed} from "./connection.ts";

// The list `programsFor` hands an agent (tracker 185b, PR 2, d8), read straight from the host's
// own function, on every door it has: the host's ledger, the agent's own session, and the
// read-only door when that session could not be made. Today's version. No program holds an input
// only a person tells (such as the tracker's `answer` and `rate_duplicate`), so no path an agent
// has, a tool or its tsh, can reach one.
//
//   the person's list            tracker {file, answer (person only), rate_duplicate (person only), query, ...}
//   programsFor(claude).list     tracker {file, query, ...}
//
// The MCP door makes no tool for such an input anyway (mcp/tools.ts), so a tool list cannot show
// what the list holds. Here `serveAgent` is caught as the host calls it, and its `programsFor` is
// asked directly. Nothing else runs.

/** What the host handed `serveAgent`, for each agent that attached. */
const handed = vi.hoisted(() => ({options: [] as AgentOptions[]}));

vi.mock("@kampus/fabrika-old/mcp", async (importOriginal) => ({
	...(await importOriginal<typeof import("@kampus/fabrika-old/mcp")>()),
	serveAgent: (_socket: unknown, options: AgentOptions) =>
		Effect.sync(() => {
			handed.options.push(options);
		}),
}));

const traces = Effect.runSync(
	Effect.gen(function* () {
		return yield* Traces;
	}).pipe(Effect.provide(memoryTraces([]))),
);

const PERSON = {kind: "user", id: "owner"} as const;
const CLAUDE = {kind: "agent", id: "claude", for: "owner"} as const;
const noPullRequests = {open: Effect.succeed([])};

/** Whether a declared input is one only a person tells (`{personOnly: true}`). */
const isPersonOnly = (declared: unknown): boolean =>
	typeof declared === "object" &&
	declared !== null &&
	"personOnly" in declared &&
	declared.personOnly === true;

/** Every input only a person tells, in `list`, as `<program>.<input>`. */
const personOnlyIn = (list: Shell.ProgramList) =>
	[...list.values()].flatMap((entry) =>
		Object.entries(entry.program.inputs)
			.filter(([, declared]) => isPersonOnly(declared))
			.map(([name]) => `${entry.program.name}.${name}`),
	);

/** Wait for `check` to answer something, five seconds at most. */
const until = <T>(what: string, check: () => T | undefined) =>
	Effect.gen(function* () {
		for (let i = 0; i < 1000; i += 1) {
			const got = check();

			if (got !== undefined) {
				return got;
			}

			yield* Effect.sleep("5 millis");
		}

		return yield* Effect.die(`waited for ${what}`);
	});

/** The host's agents' socket with `sessionFor`, one agent attached, and what it is served. */
const servedTo = (sessionFor: AgentSessions | null) =>
	Effect.gen(function* () {
		handed.options.length = 0;
		const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({prefix: "al-"});
		const path = `${dir}/mcp.sock`;
		const server = yield* NodeSocketServer.make({path});
		yield* serveAgents({
			server,
			ports: () => [],
			attached: () => Effect.void,
			job: () => null,
			stop: () => Effect.die("no stop is asked here"),
			line: () => Effect.die("no line is asked here"),
			sessionFor,
		}).pipe(Effect.forkScoped);
		const client = createConnection(path);
		yield* Effect.addFinalizer(() => Effect.sync(() => client.destroy()));
		const options = yield* until("serveAgent's options", () => handed.options[0]);
		return yield* options.programsFor(CLAUDE);
	}).pipe(
		Effect.scoped,
		Effect.provideService(Ledger, memoryService()),
		Effect.provideService(Author, PERSON),
		Effect.provideService(PullRequests, noPullRequests),
		Effect.provideService(Traces, traces),
		Effect.provide(NodeFileSystem.layer),
	);

/** An agent's own session, on a ledger of its own, writing as it. */
const session: AgentSessions = () =>
	Effect.succeed(Context.make(Ledger, memoryService()).pipe(Context.add(Author, CLAUDE)));

/** A session that could not be made: the agent gets the read-only door. */
const refused: AgentSessions = () => Effect.fail(new ConnectFailed({why: "no key here"}));

describe("programsFor: the list an agent is served", () => {
	it("is the person's programs, less every input only a person tells, on every door", async () => {
		// The person's list does hold such inputs, so the check below is not empty by luck.
		const theirs = personOnlyIn(
			Shell.programList(appPrograms(memoryService(), PERSON, noPullRequests, traces)),
		);
		expect(theirs).toEqual(expect.arrayContaining(["tracker.answer", "tracker.rate_duplicate"]));

		const doors = await Effect.runPromise(
			Effect.all(
				{host: servedTo(null), own: servedTo(session), readOnly: servedTo(refused)},
				{concurrency: 1},
			),
		);
		expect(doors.host.readOnly).toBeNull();
		expect(doors.own.readOnly).toBeNull();
		expect(doors.readOnly.readOnly).toEqual({why: "no key here"});

		for (const served of Object.values(doors)) {
			expect(personOnlyIn(served.list)).toEqual([]);
			// The tracker is still served, with the inputs anyone may tell.
			expect(Object.keys(served.list.get("tracker")?.program.inputs ?? {})).toEqual(
				expect.arrayContaining(["query", "file"]),
			);
		}
	});
});
