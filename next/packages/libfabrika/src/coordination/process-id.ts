import {Context, Effect, Layer} from "effect";
import {Id, IdGenerator} from "../data/id.ts";
import {type ProcessId} from "../data/trace.ts";

const Process = Id.make("process");

export class ProcessIdGenerator extends Context.Service<
	ProcessIdGenerator,
	{
		readonly next: Effect.Effect<typeof ProcessId.Type>;
	}
>()("@kampus/libfabrika/ProcessIdGenerator") {
	static readonly layer = Layer.effect(
		ProcessIdGenerator,
		Effect.gen(function* () {
			const generator = yield* IdGenerator;
			const next = Effect.fn("process.next")(function* () {
				return yield* generator.next(Process).pipe(Effect.orDie);
			});
			return {next: next()};
		}),
	).pipe(Layer.provide(IdGenerator.layer));
}
