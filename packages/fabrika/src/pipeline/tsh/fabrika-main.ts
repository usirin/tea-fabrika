import {homedir} from "node:os";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, Exit, FileSystem, Layer, Path, Scope} from "effect";
import {Ledger} from "../../host/ledger.ts";
import {homeOf} from "../../shell/launch.ts";
import {runTsh} from "../../shell/main.ts";
import {repoOf} from "../settings.ts";
import {loadSettings, sourceLine} from "../settings-source.ts";
import {setupLines, setupOf, shippedRubrics, writeRubrics} from "../setup.ts";
import {refOf} from "../stages/traced.ts";
import {FABRIKA_VIEWING} from "../trace/viewing.ts";
import {CONFIG_FILE, ledgerFile, readConfig, settingsWhere} from "./config.ts";
import {deskSession} from "./desk.ts";
import {programsOf} from "./fabrika-list.ts";
import {ledgerNameOf, localLedger, sqliteLedger} from "./ledger.ts";

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
// One ledger for the whole pipeline: the tea-host's `Ledger`, the Durable
// Object in Miniflare on this machine (./ledger.ts), one object per
// repository fabrika.toml is read from (named after `ledgerFile`,
// ./config.ts). operate keeps its lanes and leases in it and the desk its
// facts, so two shells on one repository share one claim per ticket and one
// desk. It is opened once, here, and closed after the desk. The node:sqlite
// file (`sqliteLedger`, at `ledgerFile`) is the way out, used when the
// repository's fabrika.toml says `[ledger] at = "sqlite"`.
//
// The run's picks (../setup.ts) are worked out here too, once, from
// fabrika.toml, tsh.toml and what the repository holds beside fabrika.toml,
// and printed, one line each, under the line that says where fabrika.toml
// came from. A repository's own rubric texts are written out under the home,
// one folder per commit they were read at, for the reviewer to read.
const user = homedir();
const home = homeOf(process.env, user);
const read = await Effect.runPromise(
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* readConfig(path.join(process.cwd(), CONFIG_FILE), {home, user});
		const start = yield* repoOf(process.cwd());
		const where = settingsWhere(config, start);
		const {settings, source, holds} = yield* loadSettings(where);
		const file = yield* ledgerFile(home, where);
		const repo = path.join(home, "rubrics", source.from === "repo" ? source.commit : "folder");
		if (settings.review?.rubrics !== undefined) yield* writeRubrics(repo, holds.rubrics);
		const setup = setupOf(settings, holds, config.said, {shipped: yield* shippedRubrics(), repo});
		const lines = setupLines(setup, holds, settings);
		const persist = path.join(home, "ledgers", "local");
		yield* (yield* FileSystem.FileSystem)
			.makeDirectory(persist, {recursive: true})
			.pipe(Effect.orDie);
		// One object per repository: named after its file's folder (github, folders) and name.
		const ledger = ledgerNameOf(`${path.basename(path.dirname(file))}-${path.basename(file)}`);
		return {config, start, settings, source, persist, ledger, file, setup, lines};
	}).pipe(Effect.result, Effect.provide(nodeServices)),
);

if (read._tag === "Failure") {
	process.stderr.write(`tsh: ${read.failure.why}\n`);
	process.exitCode = 2;
} else {
	const {config, start, settings, source, persist, ledger: name, file, setup, lines} = read.success;
	process.stderr.write(`${sourceLine(source)}\n`);
	for (const line of lines) process.stderr.write(`  ${line}\n`);
	const open = Effect.runSync(Scope.make());
	const picked =
		setup.ledger.value === "sqlite" ? sqliteLedger(file) : localLedger({persist, ledger: name});
	// Started on first use, once: after tsh has taken its home's lock, so a second tsh is refused by
	// the lock before it starts a ledger of its own.
	const once = await Effect.runPromise(
		Effect.cached(
			Layer.buildWithScope(picked, open).pipe(Effect.map(Context.get(Ledger)), Effect.orDie),
		),
	);
	const ledger = Layer.effect(Ledger, once);
	// The owner's desk lives as long as this tsh: closed after the last line, so its pages are whole.
	const desk = deskSession(settings, {home, folder: start, user}, ledger);
	process.exitCode = await runTsh({
		list: programsOf(config, process.env.TSH_SCRIPTED, desk, ledger, setup),
		viewing: FABRIKA_VIEWING,
		short: refOf,
	});
	await Effect.runPromise(desk.close);
	await Effect.runPromise(Scope.close(open, Exit.void));
}
