import {homedir} from "node:os";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {runTsh} from "@tea-fabrika/tsh";
import {homeOf} from "@tea-fabrika/tsh/launch";
import {Effect, Path} from "effect";
import {refOf} from "../stages/traced.ts";
import {FABRIKA_VIEWING} from "../trace/viewing.ts";
import {CONFIG_FILE, readConfig} from "./config.ts";
import {programsOf} from "./fabrika-list.ts";

// fabrika's tsh, the one `bin/tsh` and `pnpm tsh` start: tsh handed
// fabrika's programs (./fabrika-list.ts), made from the `tsh.toml` in the
// folder it is started in (./config.ts), its trace rules, and a title that
// shows a GitHub ticket or pull request by its number. A `tsh.toml` that does
// not fit stops it before anything runs.
const user = homedir();
const read = await Effect.runPromise(
	Effect.gen(function* () {
		const path = yield* Path.Path;
		return yield* readConfig(path.join(process.cwd(), CONFIG_FILE), {
			home: homeOf(process.env, user),
			user,
		});
	}).pipe(Effect.result, Effect.provide(nodeServices)),
);

if (read._tag === "Failure") {
	process.stderr.write(`tsh: ${read.failure.why}\n`);
	process.exitCode = 2;
} else {
	process.exitCode = await runTsh({
		list: programsOf(read.success, process.env.TSH_SCRIPTED),
		viewing: FABRIKA_VIEWING,
		short: refOf,
	});
}
