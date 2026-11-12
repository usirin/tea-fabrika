import { Effect, FileSystem, Path } from "effect";

// The app's and the host's own private records: one JSON value a line, appended, in a records
// folder of a home (ticket 276, "What this records"). Wide, as the plan asks: each line keeps what
// was known when it was written, and an older line keeps an unknown fact unknown (`null`). A record
// never holds a credential, a URL or an environment value; a local path stays in these private
// files and never in a public capture.
//
//   yield* appendRecord("<home>/records/host.jsonl", {kind: "host", project: "3f9a…", pid: 4121})
//   // {"kind":"host","project":"3f9a…","pid":4121}\n appended; a write that fails is logged
//
// A record that cannot be written is said in the host's log and dropped: the work it describes
// goes on.

/** Append one record, as a line of JSON, to `file`, making its folder (mode 0700) if need be. */
export const appendRecord = (file: string, row: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
    yield* fs.writeFileString(file, `${JSON.stringify(row)}\n`, { flag: "a", mode: 0o600 });
  }).pipe(Effect.catch((e) => Effect.logWarning(`fabrika: a record was not kept: ${e.message}`)));
