// `fabrika connect`, `invite`, `members`, `move` and `post`: a home's ledger server, from the
// command line. The steps are host/connection.ts's, move.ts's and post.ts's; this file only reads
// the words.
//
//   FABRIKA_HOME=<home> pnpm --filter @kampus/fabrika-app cli connect https://ledger.example.com/acme \
//     --login alice --key ~/.ssh/id_ed25519
//   // connected as user:github:7; the host restarts on it (host/connection.ts, `connectAndRestart`)
//   FABRIKA_HOME=<home> pnpm --filter @kampus/fabrika-app cli invite bob
//   // invited bob (github:8): they get in at their first login
//   FABRIKA_HOME=<home> pnpm --filter @kampus/fabrika-app cli move --from <home>/ledger.sqlite \
//     --to https://ledger.example.com/acme --dry-run --founder github:7
//   // streams, events, writers, anything it cannot map, and the hash; nothing written
//   FABRIKA_HOME=<home> pnpm --filter @kampus/fabrika-app cli move --from <home>/ledger.sqlite \
//     --to https://ledger.example.com/acme --login alice --key ~/.ssh/id_ed25519
//   // the tickets moved and sealed (host/move.ts); the home now uses the server
//   FABRIKA_HOME=<home> pnpm --filter @kampus/fabrika-app cli post comment 9 --as triage \
//     --body-file note.md
//   // as agent:triage, for the home's person (host/post.ts); then the tickets, one line each
//   FABRIKA_HOME=<home> node apps/fabrika/src/cli.ts mcp --as claude
//   // the MCP bridge an agent's client starts (host/agents.ts): stdin and stdout to the running
//   // host's agents' socket, as agent:claude, for the home's person
//
// FABRIKA_HOME is always given, as for the host (host/main.ts): this never guesses a home, so a
// test's home is never the owner's. The owner names theirs.
import {NodeRuntime, NodeServices, NodeSocket} from "@effect/platform-node";
import {writerText} from "@kampus/fabrika";
import {BridgeStopped, bridge} from "@kampus/fabrika/mcp";
import {Config, Console, Effect, Logger, Option} from "effect";
import {Argument, Command, Flag} from "effect/cli";
import {addressOf, connectAndRestart, invite, members} from "./host/connection.ts";
import {dryRun, MoveStopped, move, reportOf} from "./host/move.ts";
import {type Post, post} from "./host/post.ts";
import {pathsOf, reach} from "./host/socket.ts";

const home = Flag.String("home").pipe(
	Flag.withDescription("the app's home: FABRIKA_HOME"),
	Flag.withFallbackConfig(Config.String("FABRIKA_HOME")),
);

const connectCmd = Command.make(
	"connect",
	{
		home,
		address: Argument.String("address").pipe(
			Argument.withDescription("the ledger's address: the server's URL, then the project"),
		),
		login: Flag.String("login").pipe(Flag.withDescription("your GitHub login")),
		key: Flag.String("key").pipe(Flag.withDescription("your SSH key file, Ed25519, no passphrase")),
	},
	(a) =>
		Effect.gen(function* () {
			const {who, host} = yield* connectAndRestart(a.home, {
				address: a.address,
				login: a.login,
				key: a.key,
			});
			const as = `connected as ${writerText(who)}`;
			if (host === "stopped")
				yield* Effect.logInfo(
					`${as}; the host stopped, and an open app starts it again on this ledger. Running jobs stopped too: attach %n brings each back`,
				);
			else if (host === "none") yield* Effect.logInfo(`${as}; the app uses it when it starts`);
			else
				yield* Effect.logWarning(
					`${as}, but the running host did not stop (${host.why}): quit the app and stop its host to use it`,
				);
		}),
);

const inviteCmd = Command.make(
	"invite",
	{home, login: Argument.String("login").pipe(Argument.withDescription("their GitHub login"))},
	(a) =>
		Effect.gen(function* () {
			const m = yield* invite(a.home, a.login);
			yield* Effect.logInfo(`invited ${m.name} (${m.id}): they get in at their first login`);
		}),
);

const membersCmd = Command.make("members", {home}, (a) =>
	Effect.gen(function* () {
		const m = yield* members(a.home);
		for (const p of m.members) yield* Effect.logInfo(`member   ${p.name} (${p.id})`);
		for (const p of m.invited) yield* Effect.logInfo(`invited  ${p.name} (${p.id})`);
	}),
);

const moveCmd = Command.make(
	"move",
	{
		home,
		from: Flag.String("from").pipe(Flag.withDescription("the laptop's ledger file, read only")),
		to: Flag.String("to").pipe(
			Flag.withDescription("the new ledger's address: the server's URL, then the project"),
		),
		login: Flag.optional(Flag.String("login")).pipe(Flag.withDescription("your GitHub login")),
		key: Flag.optional(Flag.String("key")).pipe(
			Flag.withDescription("your SSH key file, Ed25519, no passphrase"),
		),
		// Left out, it is a real move: a boolean flag without a default is a required one.
		dryRun: Flag.Boolean("dry-run").pipe(
			Flag.withDefault(false),
			Flag.withDescription("print the counts and the hash, and write nothing anywhere"),
		),
		founder: Flag.optional(Flag.String("founder")).pipe(
			Flag.withDescription("with --dry-run: your id on the ledger, github:<n>, for the hash"),
		),
	},
	(a) =>
		Effect.gen(function* () {
			yield* addressOf(a.to);
			if (a.dryRun) {
				if (Option.isNone(a.founder))
					return yield* new MoveStopped({
						why: "a dry run names your id, --founder github:<n>, so its hash is the move's",
					});
				const r = yield* dryRun({home: a.home, from: a.from, founder: a.founder.value});
				for (const line of reportOf(r.plan, r.hash)) yield* Effect.logInfo(line);
				if (Option.isSome(r.running))
					yield* Effect.logInfo(`${r.running.value}: stop it before the move`);
				return;
			}
			if (Option.isNone(a.login) || Option.isNone(a.key))
				return yield* new MoveStopped({why: "a move logs in: --login and --key"});
			const done = yield* move({
				home: a.home,
				from: a.from,
				to: a.to,
				login: a.login.value,
				key: a.key.value,
			});
			for (const line of reportOf(done.plan, done.hash)) yield* Effect.logInfo(line);
			yield* Effect.logInfo(
				`moved and sealed; ${a.from} stays as it was; start the app again to use ${a.to}`,
			);
		}),
);

const as = Flag.String("as").pipe(
	Flag.withDescription("the agent's name: it writes as agent:<name>, for you"),
);
const body = Flag.FileText("body-file").pipe(Flag.withDescription("the text, in a file"));
const ticket = Argument.Int("ticket").pipe(Argument.withDescription("the ticket's number"));

/** One post, then the tickets after it. */
const posting = (a: {readonly home: string; readonly as: string}, writes: ReadonlyArray<Post>) =>
	Effect.gen(function* () {
		for (const line of yield* post(a.home, a.as, writes)) yield* Effect.logInfo(line);
	});

const postCmd = Command.make("post").pipe(
	Command.withSubcommands([
		Command.make(
			"file",
			{home, as, body, title: Argument.String("title").pipe(Argument.withDescription("its title"))},
			(a) => posting(a, [{type: "file", value: {title: a.title, body: a.body.trim()}}]),
		),
		Command.make("comment", {home, as, body, ticket}, (a) =>
			posting(a, [{type: "comment", value: {ticket: a.ticket, body: a.body.trim()}}]),
		),
		Command.make("close", {home, as, ticket}, (a) =>
			posting(a, [{type: "close", value: {ticket: a.ticket}}]),
		),
		Command.make("list", {home, as}, (a) => posting(a, [])),
	]),
);

/**
 * The MCP bridge an agent's client starts: the agents' socket of the home's running host, on
 * stdin and stdout. Stdout is the client's alone, so every word of ours goes to stderr. It starts
 * no host: with none, it says so and ends.
 */
const mcpCmd = Command.make("mcp", {home, as}, (a) =>
	Effect.gen(function* () {
		const {mcp} = yield* pathsOf(a.home);
		if ((yield* reach(mcp)) !== "live")
			return yield* new BridgeStopped({
				why: `no fabrika host serves agents on ${a.home}: open the app on it (a home connected to a ledger server has no agents' socket yet)`,
			});
		yield* bridge(yield* NodeSocket.makeNet({path: mcp}), a.as);
	}).pipe(
		Effect.scoped,
		Effect.catch((e) =>
			Console.error(`fabrika mcp: ${e._tag === "BridgeStopped" ? e.why : String(e)}`).pipe(
				Effect.andThen(
					Effect.sync(() => {
						process.exitCode = 1;
					}),
				),
			),
		),
		// The bridge is over, but Node's stdin still holds the process open while the client keeps
		// its end: let go of it, so the client sees this process end. Node, at this command's edge.
		Effect.ensuring(Effect.sync(() => process.stdin.destroy())),
		Effect.provideService(Logger.LogToStderr, true),
	),
);

const fabrika = Command.make("fabrika").pipe(
	Command.withSubcommands([connectCmd, inviteCmd, membersCmd, moveCmd, postCmd, mcpCmd]),
);

NodeRuntime.runMain(
	Command.run(fabrika, {version: "0.0.0"}).pipe(Effect.provide(NodeServices.layer)),
);
