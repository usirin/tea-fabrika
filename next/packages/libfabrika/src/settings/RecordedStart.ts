import { type Config, Context } from "effect";
import type * as Declarations from "./Declarations.ts";
import type * as Snapshot from "./Snapshot.ts";
import type * as Start from "./Start.ts";

export class RecordedStart extends Context.Service<
  RecordedStart,
  {
    readonly input: Start.Input;
    readonly receipt: Start.Receipt;
    readonly snapshot: Snapshot.Snapshot;
    readonly values: Config.Success<typeof Declarations.all>;
  }
>()("@kampus/libfabrika/settings/RecordedStart") {}
