import {Context, Effect, Layer} from "effect";
import {type ProcessId} from "../data/trace.ts";
import * as Id from "../id.ts";

export class ProcessIdGenerator extends Context.Service<
	ProcessIdGenerator,
	{
		readonly next: Effect.Effect<typeof ProcessId.Type>;
	}
>()("@kampus/libfabrika/ProcessIdGenerator") {
	static readonly layer = Layer.effect(
		ProcessIdGenerator,
		Effect.map(Id.Generator, (generator) => {
			const next = Effect.fn("process.next")(function* () {
				return yield* generator.next(Id.Process).pipe(Effect.orDie);
			});
			return {next: next()};
		}),
	).pipe(Layer.provide(Id.Generator.layer));
}
