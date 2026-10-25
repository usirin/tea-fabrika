// Spike 3's stack: one program that declares a Cloudflare Worker, a Docker box and our own
// Fabrika.Host side by side. The driver runs it only under `alchemy dev`, never `alchemy deploy`.
// In dev the Worker's provider picks its local variant (workerd on this laptop). The box and the
// Host have no variant at all: Docker is already local, and the Host is ours. Nothing here can
// reach Cloudflare: no CLOUDFLARE_* variable is set, and local dev falls back to the all-zero
// account id (@alchemy.run/cloudflare src/LocalAccount.ts).
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Docker from "@alchemy.run/docker";
import * as Alchemy from "alchemy";
import {Config, Effect, Layer} from "effect";
import {Host, HostProvider, Processes} from "./host.ts";

export default Alchemy.Stack(
	"exp146-local",
	{
		providers: Layer.mergeAll(
			Cloudflare.providers(),
			Docker.providers(),
			HostProvider().pipe(Layer.provide(Processes.node)),
		),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const home = yield* Config.String("HOST_HOME");
		const run = yield* Config.String("BOX_RUN");
		const worker = yield* Cloudflare.Worker("hello", {
			// A raw module, so nothing is bundled: the smallest Worker there is.
			script: `export default { fetch: () => new Response("hello from workerd " + navigator.userAgent) };`,
		});
		// alpine:latest is already on this laptop; the trap makes `docker stop` quick (spike 2).
		const box = yield* Docker.Container("box", {
			image: "alpine:latest",
			command: ["sh", "-c", "trap 'exit 0' TERM; sleep 3600 & wait"],
			labels: {exp146: run},
			start: true,
		});
		const host = yield* Host("laptop", {home, programs: ["counter"], ledger: "memory"});
		return {url: worker.url, box: box.id, pid: host.pid};
	}),
);
