import { Brain } from "@kampus/libfabrika/workers/objects";
import { RecordPartLive } from "@kampus/libfabrika/workers/record";
import { Effect } from "effect";
export default Brain.make({ main: import.meta.url }, Effect.succeed({}).pipe(Effect.provide(RecordPartLive)));
