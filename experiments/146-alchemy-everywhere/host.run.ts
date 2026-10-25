// Spike 1's stack: one `Fabrika.Host` on this laptop. The driver (../146-alchemy-everywhere.ts)
// deploys it, deploys it again with changed inputs, kills it out of band for `drift`, and
// destroys it. The inputs come from the environment so one file serves every step.
import * as Alchemy from "alchemy";
import {Config, Effect, Layer} from "effect";
import {Host, HostProvider, Processes} from "./host.ts";

export default Alchemy.Stack(
	"exp146-host",
	{
		providers: HostProvider().pipe(Layer.provide(Processes.node)),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const home = yield* Config.String("HOST_HOME");
		const programs = (yield* Config.String("HOST_PROGRAMS")).split(",");
		const ledger = yield* Config.Literals(["memory", "local"], "HOST_LEDGER");
		const host = yield* Host("laptop", {home, programs, ledger});
		return {pid: host.pid, socket: host.socket, reloads: host.reloads};
	}),
);
