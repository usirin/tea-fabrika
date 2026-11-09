import {projectRuntime as runtime, type Env as Bindings} from "@kampus/libfabrika/workers/runtime";
import {Effect, Schema} from "effect";
import {programs} from "virtual:fabrika-built";
import {Door} from "./door.ts";
import {Settings} from "./settings.ts";

export interface Env extends Bindings {
	readonly STAGE: string;
}
export const settings = (env: Env) =>
	Schema.decodeUnknownSync(Schema.fromJsonString(Settings))(env.STAGE);
export const projectRuntime = (ctx: DurableObjectState, env: Env) => {
	const config = settings(env);
	return runtime(ctx, env, {
		config,
		programs,
		bootstrap: {name: "counter:1", id: "counter:1", program: "counter"},
		door: (options) =>
			Door.pipe(
				Effect.provide(
					Door.layer({
						...options,
						name: ctx.id.name ?? config.name,
						url: `http://127.0.0.1:${config.port}`,
						origins: [`http://127.0.0.1:${config.port}`],
						location: "local",
						build: config.build,
						versions: [1],
						waiting: {most: 64, ttl: 600_000},
						ping: {min: 30_000, max: 75_000},
						inputCap: 1_000_000,
						spentCap: 100_000,
						deliver: (pid, _envelope, _span, incoming) => options.deliver(pid, incoming),
						inputs: {
							schema: Schema.Json,
							log: Schema.Json,
							raw: [],
							personOnly: [],
							name: (m) =>
								typeof m === "object" && m !== null && "type" in m && typeof m.type === "string"
									? m.type
									: undefined,
						},
						facts: {personOnly: []},
					}),
				),
			),
	});
};
