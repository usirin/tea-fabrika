import {homedir} from "node:os";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {runTsh} from "@tea-fabrika/tsh";
import {homeOf} from "@tea-fabrika/tsh/launch";
import {Effect, Layer, Path} from "effect";
import {diskLedger} from "../asks/ledger-disk.ts";
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
// operate keeps its lanes and claims in the ledger on disk for the same
// repository fabrika.toml is read from (`ledgerFile`, ./config.ts), so two
// shells on one repository share one claim per ticket.
const user = homedir();
const home = homeOf(process.env, user);
const read = await Effect.runPromise(
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* readConfig(path.join(process.cwd(), CONFIG_FILE), {home, user});
		const start = yield* repoOf(process.cwd());
		const where = settingsWhere(config, start);
		const {settings, source} = yield* loadSettings(where);
		const ledger = yield* ledgerFile(home, where);
		return {config, start, settings, source, ledger};
	}).pipe(Effect.result, Effect.provide(nodeServices)),
);

if (read._tag === "Failure") {
	process.stderr.write(`tsh: ${read.failure.why}\n`);
	process.exitCode = 2;
} else {
	const {config, start, settings, source, ledger} = read.success;
	process.stderr.write(`${sourceLine(source)}\n`);
	// The owner's desk lives as long as this tsh: closed after the last line, so its pages are whole.
	const desk = deskSession(settings, {home, folder: start, user});
	process.exitCode = await runTsh({
		list: programsOf(
			config,
			process.env.TSH_SCRIPTED,
			desk,
			diskLedger(ledger).pipe(Layer.provide(nodeServices)),
		),
		viewing: FABRIKA_VIEWING,
		short: refOf,
	});
	await Effect.runPromise(desk.close);
}
