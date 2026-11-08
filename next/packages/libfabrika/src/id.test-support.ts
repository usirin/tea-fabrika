import {Effect} from "effect";
import * as Id from "./id.ts";

// Keep PR 1's fixtures unbranded, like data/trace.ts's ProcessId.
export const processId: Effect.Effect<string> = Id.Generator.use((ids) =>
	ids.next(Id.Process),
).pipe(Effect.provide(Id.Generator.layer));
