import {homedir} from "node:os";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {runTsh} from "@tea-fabrika/tsh";
import {homeOf} from "@tea-fabrika/tsh/launch";
import {Effect, Path} from "effect";
import {readSettings, repoOf, SETTINGS_FILE} from "../settings.ts";
import {refOf} from "../stages/traced.ts";
import {FABRIKA_VIEWING} from "../trace/viewing.ts";
import {CONFIG_FILE, readConfig} from "./config.ts";
import {deskSession} from "./desk.ts";
import {programsOf} from "./fabrika-list.ts";

// fabrika's tsh, the one `bin/tsh` and `pnpm tsh` start: tsh handed
// fabrika's programs (./fabrika-list.ts), made from the `tsh.toml` in the
// folder it is started in (./config.ts), its trace rules, and a title that
// shows a GitHub ticket or pull request by its number.
//
// This is the edge, and the one place either file is read. The repository it
// works on is the one the folder is in (its root holds `.git`), and its
// `fabrika.toml` sits at that root (../settings.ts): the desk is handed its
// packs, found from that folder. A file that does not fit stops tsh before
// anything runs.
const user = homedir();
const home = homeOf(process.env, user);
const read = await Effect.runPromise(
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* readConfig(path.join(process.cwd(), CONFIG_FILE), {home, user});
		const repo = yield* repoOf(process.cwd());
		const settings = yield* readSettings(path.join(repo, SETTINGS_FILE));
		return {config, repo, settings};
	}).pipe(Effect.result, Effect.provide(nodeServices)),
);

if (read._tag === "Failure") {
	process.stderr.write(`tsh: ${read.failure.why}\n`);
	process.exitCode = 2;
} else {
	const {config, repo, settings} = read.success;
	// The owner's desk lives as long as this tsh: closed after the last line, so its pages are whole.
	const desk = deskSession(settings, {home, folder: repo, user});
	process.exitCode = await runTsh({
		list: programsOf(config, process.env.TSH_SCRIPTED, desk),
		viewing: FABRIKA_VIEWING,
		short: refOf,
	});
	await Effect.runPromise(desk.close);
}
