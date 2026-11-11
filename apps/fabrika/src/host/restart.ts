import { writerOf, writerText } from "@kampus/fabrika-old";
import { Why } from "@kampus/fabrika-old/mcp";
import { Effect, FileSystem, Path, Schema } from "effect";
import type { HostPaths } from "./socket.ts";

// The note a restart leaves for the next host (tracker 185b, PR 5; the owner's call A): who
// restarted it, why, when, and which jobs it left detached. Without it, a restart looks like a
// crash to the person. The next host reads it as it starts, says it once in its log, in the top
// bar's host lines and in each tile's "jobs from an earlier tsh" line, and removes it.
//
//   <home>/host/restart.json, mode 0600, beside the socket and the pid:
//   {"by": "agent:claude for:owner", "why": "pick up the new build", "at": 1767225600000, "detached": [2]}
//   {"by": "user:owner", "why": null, "at": 1767225600000}     the person's, from the window
//
// Two writers, one shape. An agent's `restart` is written by the host it restarts (host/serve.ts),
// which knows the jobs it leaves. The person's is written by the app before it stops the host
// (attach.ts, `restart`): the app knows who pressed the button, so the host never guesses it from a
// SIGTERM, and a plain stop (`fabrika connect`, a test's) leaves no note.
//
// A file that does not read, or names no writer, is said in the log and removed: the host starts as
// any host starts, and names no restart. A file another local process of the user's wrote is
// trusted as it reads.

/** A writer's text, as a row keeps it (`user:owner`, `agent:claude for:owner`). */
const By = Schema.String.check(
  Schema.makeFilter((by) => writerOf(by) !== null || "a writer's text, as user:owner or agent:claude for:owner"),
);

/** What restart.json holds. `detached` is the host's own; the app's note for the person has none. */
export const RestartNote = Schema.Struct({
  by: By,
  /** The agent's why, on one line; `null` for the person's restart, which asks none. */
  why: Schema.NullOr(Why),
  /** When it was written, by the writer's clock, in milliseconds since 1970. */
  at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  detached: Schema.optionalKey(Schema.Array(Schema.Int)),
});
export type RestartNote = typeof RestartNote.Type;

const decodeNote = Schema.decodeUnknownEffect(Schema.fromJsonString(RestartNote));

/**
 * The note's file: beside the host's log, in its durable folder (`<home>/host/`), never in the
 * short runtime folder a project's sockets use (project.ts), which a reboot may empty.
 */
const fileIn = (paths: HostPaths) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join(path.dirname(paths.log), "restart.json");
  });

/** Leave `note` for the next host: written beside, then moved over, so it is never read half written. */
export const leaveNote = (paths: HostPaths, note: RestartNote) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fileIn(paths);
    yield* fs.writeFileString(`${file}.new`, `${JSON.stringify(note)}\n`, { mode: 0o600 });
    yield* fs.rename(`${file}.new`, file);
  });

/** The note goes unread: the restart it was left for did not happen. */
export const forgetNote = (paths: HostPaths) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(yield* fileIn(paths)).pipe(Effect.ignore);
  });

/**
 * Take the note a restart left, as a host starts: it is read once, then removed, so only the host
 * right after the restart says it. `null`: there was none, or it did not read (said in the log).
 */
export const takeNote = (paths: HostPaths) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fileIn(paths);

    if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) {
      return null;
    }

    const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    yield* forgetNote(paths);
    return yield* decodeNote(text).pipe(
      Effect.catch((e) =>
        Effect.as(
          Effect.logWarning(`fabrika host: ${file} did not read, so this start names no restart: ${e.message}`),
          null,
        ),
      ),
    );
  });

/** The person on a home: the owner of a home's own file; on a connected home, the login it signs in as. */
const Login = Schema.Struct({ login: Schema.String.check(Schema.isPattern(/^\S{1,100}$/)) });
const decodeLogin = Schema.decodeUnknownEffect(Schema.fromJsonString(Login));

/**
 * The person at the window, as a writer's text, for their own restart's note. Read from the home's
 * `ledger.json` (host/connection.ts's `CONNECTION_FILE`) alone, so the app's main loads none of the
 * ledger's code: `user:owner` on a home with none, `user:<login>` on a connected home. `null`: a
 * `ledger.json` that does not read, which no host starts on either, so no note is left.
 */
export const personOn = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(home, "ledger.json");

    if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) {
      return writerText({ kind: "user", id: "owner" });
    }

    const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    return yield* decodeLogin(text).pipe(
      Effect.map(({ login }) => writerText({ kind: "user", id: login })),
      Effect.orElseSucceed(() => null),
    );
  });
