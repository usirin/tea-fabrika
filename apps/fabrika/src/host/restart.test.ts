import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path, type Scope } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { leaveNote, personOn, takeNote } from "./restart.ts";
import type { HostPaths } from "./socket.ts";

// Who the person's own restart names (tracker 185b, PR 5): read from the home's ledger.json alone.
// Today's version. Owed by the mutation step on PR 382: no test before reached a connected home.
//
//   no ledger.json                    user:owner
//   ledger.json {"login": "ana"}      user:ana
//   a login that is not one word of 1 to 100 characters, none, or a file that does not read: null

const run = <A, E>(test: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))));

/** The person on a fresh home whose ledger.json holds `text`, or none when `text` is null. */
const personWith = (text: string | null) =>
  run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pr-" });

      if (text !== null) {
        yield* fs.writeFileString(path.join(home, "ledger.json"), text);
      }

      return yield* personOn(home);
    }),
  );

describe("the person a restart from the window names", () => {
  it("is the owner on a home with no ledger.json", async () => {
    expect(await personWith(null)).toBe("user:owner");
  });

  it("is the login a connected home signs in as", async () => {
    expect(await personWith(JSON.stringify({ login: "ana" }))).toBe("user:ana");
    const longest = "a".repeat(100);
    expect(await personWith(JSON.stringify({ login: longest }))).toBe(`user:${longest}`);
  });

  it("is none for a login that is not one word of 1 to 100 characters, no login, or a file that does not read", async () => {
    for (const text of [
      JSON.stringify({ login: "a b" }),
      JSON.stringify({ login: "a".repeat(101) }),
      JSON.stringify({ login: "a\nb" }),
      JSON.stringify({ login: "" }),
      JSON.stringify({ url: "https://ledger.example" }),
      "not json",
    ]) {
      expect(await personWith(text), text).toBeNull();
    }
  });
});

// The restart note's place: <durable folder>/restart.json, beside the host's log, wherever the
// short runtime folder (the sockets, the lock) is. Owed by the mutation step on ticket 276: the
// laws above reach only `personOn`, so a note's file name or folder could move and stay green.
describe("the restart note's file", () => {
  it("is restart.json beside the log, whatever the runtime paths are, and is taken once", async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z]{1,8}$/), fc.integer({ min: 0, max: 2 ** 40 }), async (name, at) => {
        const note = { by: "user:owner", why: null, at };
        const found = await run(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const home = yield* fs.makeTempDirectoryScoped({ prefix: "rn-" });
            const durable = path.join(home, name);
            yield* fs.makeDirectory(durable, { recursive: true });
            const paths: HostPaths = {
              dir: path.join(home, "run"),
              sock: path.join(home, "run", "s"),
              mcp: path.join(home, "run", "m"),
              pid: path.join(home, "run", "pid"),
              lock: path.join(home, "run", "lock"),
              log: path.join(durable, "log"),
            };
            yield* leaveNote(paths, note);
            const left = yield* fs.exists(path.join(durable, "restart.json"));
            const taken = yield* takeNote(paths);
            const again = yield* takeNote(paths);
            const gone = !(yield* fs.exists(path.join(durable, "restart.json")));
            return { left, taken, again, gone };
          }),
        );
        expect(found).toEqual({ left: true, taken: note, again: null, gone: true });
      }),
      { numRuns: 15 },
    );
  });
});
