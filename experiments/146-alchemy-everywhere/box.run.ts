// Spike 2's stack: a box an agent could run in, through @alchemy.run/docker 2.0.0-beta.84. An
// image built from box/Dockerfile, and a container from it, both labelled exp146=<run>. The
// driver deploys it, deploys it again with a new task (BOX_TASK), and destroys it.
import * as Docker from "@alchemy.run/docker";
import * as Alchemy from "alchemy";
import {Config, Effect} from "effect";

export default Alchemy.Stack(
	"exp146-box",
	{providers: Docker.providers(), state: Alchemy.localState()},
	Effect.gen(function* () {
		const run = yield* Config.String("BOX_RUN");
		const task = yield* Config.String("BOX_TASK");
		const image = yield* Docker.Image("box-image", {
			name: `exp146-box-${run}`,
			tag: "v1",
			build: {
				context: new URL("./box", import.meta.url).pathname,
				args: {RUN: run},
			},
		});
		// A fake key, made fresh by the driver for each run, to see where a Redacted value ends up.
		const key = yield* Config.Redacted("BOX_FAKE_KEY");
		const box = yield* Docker.Container("box", {
			image,
			labels: {exp146: run},
			environment: {TASK: task, FAKE_KEY: key},
			start: true,
		});
		return {id: box.id, name: box.name, status: box.status, image: image.imageRef};
	}),
);
