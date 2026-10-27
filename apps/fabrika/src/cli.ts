// `fabrika connect`, `invite`, `members`, `move` and `post`: a home's ledger server, from the
// command line. The steps are host/connection.ts's, move.ts's and post.ts's; this file only reads
// the words.
//
//   FABRIKA_HOME=<home> pnpm --filter @kampus/fabrika-app cli connect https://ledger.example.com/acme \
//     --login alice --key ~/.ssh/id_ed25519
//   // connected as user:github:7; start the app again to use it
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
//
// FABRIKA_HOME is always given, as for the host (host/main.ts): this never guesses a home, so a
// test's home is never the owner's. The owner names theirs.
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {writerText} from "@kampus/fabrika";
import type {Do} from "@tea-fabrika/tracker";
import {Config, Effect, Option} from "effect";
import {Argument, Command, Flag} from "effect/cli";
import {addressOf, connect, invite, members} from "./host/connection.ts";
import {dryRun, MoveStopped, move, reportOf} from "./host/move.ts";
import {post} from "./host/post.ts";

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
const posting = (a: {readonly home: string; readonly as: string}, writes: ReadonlyArray<Do>) =>
	Effect.gen(function* () {
		for (const line of yield* post(a.home, a.as, writes)) yield* Effect.logInfo(line);
	});

const postCmd = Command.make("post").pipe(
	Command.withSubcommands([
		Command.make(
			"file",
			{home, as, body, title: Argument.String("title").pipe(Argument.withDescription("its title"))},
			(a) => posting(a, [{kind: "file", title: a.title, body: a.body.trim()}]),
		),
		Command.make("comment", {home, as, body, ticket}, (a) =>
			posting(a, [{kind: "comment", ticket: a.ticket, body: a.body.trim()}]),
		),
		Command.make("close", {home, as, ticket}, (a) =>
			posting(a, [{kind: "close", ticket: a.ticket}]),
		),
		Command.make("list", {home, as}, (a) => posting(a, [])),
	]),
);

const fabrika = Command.make("fabrika").pipe(
	Command.withSubcommands([connectCmd, inviteCmd, membersCmd, moveCmd, postCmd]),
);

NodeRuntime.runMain(
	Command.run(fabrika, {version: "0.0.0"}).pipe(Effect.provide(NodeServices.layer)),
);
