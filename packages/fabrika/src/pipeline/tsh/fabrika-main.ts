import {homedir} from "node:os";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, Exit, FileSystem, Layer, Path, Scope} from "effect";
import {Ledger} from "../../host/ledger.ts";
import {layerSqlite} from "../../host/sqlite.ts";
import {homeOf} from "../../shell/launch.ts";
import {runTsh} from "../../shell/main.ts";
import {repoOf} from "../settings.ts";
import {loadSettings, sourceLine} from "../settings-source.ts";
import {refOf} from "../stages/traced.ts";
import {FABRIKA_VIEWING} from "../trace/viewing.ts";
import {CONFIG_FILE, ledgerFile, readConfig, settingsWhere} from "./config.ts";
import {deskSession} from "./desk.ts";
import {programsOf} from "./fabrika-list.ts";

// fabrika's tsh, the one `bin/tsh` and `pnpm tsh` start: tsh handed
// fabrika's programs (./fabrika-list.ts), made from the `tsh.toml` in the
// folder it is started in (./config.ts), its trace rules, and a title that
// shows a GitHub ticket or pull request by its number.
//
// This is the edge, and the one place either file is read. `fabrika.toml`
// comes from one place (../settings-source.ts): when tsh.toml names a
// repository to work on, that repository's, as committed on its default
// branch; else the one at the root of the folder tsh starts in. tsh prints
// which, in one line, before anything runs. The desk is handed its packs,
// found from the root of the folder tsh starts in, where fabrika is
// installed: never from a target's clone. A file that does not fit stops tsh
// before anything runs.
//
// One ledger for the whole pipeline: the tea-host's `Ledger` on a node:sqlite
// file for the same repository fabrika.toml is read from (`ledgerFile`,
// ./config.ts). operate keeps its lanes and leases in it and the desk its
// facts, so two shells on one repository share one claim per ticket and one
// desk. It is opened once, here, and closed after the desk.
const user = homedir();
const home = homeOf(process.env, user);
const read = await Effect.runPromise(
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* readConfig(path.join(process.cwd(), CONFIG_FILE), {home, user});
		const start = yield* repoOf(process.cwd());
		const where = settingsWhere(config, start);
		const {settings, source} = yield* loadSettings(where);
		const file = yield* ledgerFile(home, where);
		yield* (yield* FileSystem.FileSystem)
			.makeDirectory(path.dirname(file), {recursive: true})
			.pipe(Effect.orDie);
		return {config, start, settings, source, file};
	}).pipe(Effect.result, Effect.provide(nodeServices)),
);

if (read._tag === "Failure") {
	process.stderr.write(`tsh: ${read.failure.why}\n`);
	process.exitCode = 2;
} else {
	const {config, start, settings, source, file} = read.success;
	process.stderr.write(`${sourceLine(source)}\n`);
	const open = Effect.runSync(Scope.make());
	const ledger = Layer.succeed(
		Ledger,
		await Effect.runPromise(
			Layer.buildWithScope(layerSqlite({path: file}), open).pipe(Effect.map(Context.get(Ledger))),
		),
	);
	// The owner's desk lives as long as this tsh: closed after the last line, so its pages are whole.
	const desk = deskSession(settings, {home, folder: start, user}, ledger);
	process.exitCode = await runTsh({
		list: programsOf(config, process.env.TSH_SCRIPTED, desk, ledger),
		viewing: FABRIKA_VIEWING,
		short: refOf,
	});
	await Effect.runPromise(desk.close);
	await Effect.runPromise(Scope.close(open, Exit.void));
}
