// `fabrika connect`, `fabrika invite` and `fabrika members`: a home's ledger server, from the
// command line. The steps are host/connection.ts's; this file only reads the words.
//
//   FABRIKA_HOME=<home> pnpm --filter @kampus/fabrika-app cli connect https://ledger.example.com/acme \
//     --login alice --key ~/.ssh/id_ed25519
//   // connected as user:github:7; start the app again to use it
//   FABRIKA_HOME=<home> pnpm --filter @kampus/fabrika-app cli invite bob
//   // invited bob (github:8): they get in at their first login
//
// FABRIKA_HOME is always given, as for the host (host/main.ts): this never guesses a home, so a
// test's home is never the owner's. The owner names theirs.
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {writerText} from "@kampus/fabrika";
import {Config, Effect} from "effect";
import {Argument, Command, Flag} from "effect/cli";
import {connect, invite, members} from "./host/connection.ts";

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
			const who = yield* connect(a.home, {address: a.address, login: a.login, key: a.key});
			yield* Effect.logInfo(`connected as ${writerText(who)}; start the app again to use it`);
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

const fabrika = Command.make("fabrika").pipe(
	Command.withSubcommands([connectCmd, inviteCmd, membersCmd]),
);

NodeRuntime.runMain(
	Command.run(fabrika, {version: "0.0.0"}).pipe(Effect.provide(NodeServices.layer)),
);
