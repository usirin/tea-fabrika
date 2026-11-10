import { Brain } from "@kampus/libfabrika/workers/objects";
import { RecordPartLive } from "@kampus/libfabrika/workers/record";
import { Effect } from "effect";
// oxlint-disable-next-line import/no-default-export -- edge: Alchemy runs this Worker from main: import.meta.url, and workerd loads a Worker by its default export (0058)
export default Brain.make({ main: import.meta.url }, Effect.succeed({}).pipe(Effect.provide(RecordPartLive)));
