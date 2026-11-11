import { createInterface } from "node:readline";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Exit, Layer, Result, Scope, Stream } from "effect";
import { Edit, KeybindingManager, type Snapshot } from "./keybindings.ts";

// Real separate-process save and watch checks for P13. Input and output are test data only.
const folder = process.argv[2];

if (!folder || process.env.FABRIKA_HOME !== folder) {
  throw new Error("fixture needs its private home");
}

const scope = Effect.runSync(Scope.make());

const manager = await Effect.runPromise(
  Effect.gen(function* () {
    const manager = yield* KeybindingManager.make({ folder, mac: true, by: "user:fixture" });
    return manager;
  }).pipe(Scope.provide(scope), Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
);

const watched: { latest: Snapshot | null } = { latest: null };

await Effect.runPromise(
  manager.changes.pipe(
    Stream.runForEach((snapshot) =>
      Effect.sync(() => {
        watched.latest = snapshot;
      }),
    ),
    Effect.forkIn(scope),
  ),
);

const write = (value: object) => process.stdout.write(`P13 ${JSON.stringify(value)}\n`);
write({ ready: true });
const lines = createInterface({ input: process.stdin });

try {
  for await (const line of lines) {
    const request = JSON.parse(line);

    if (request.type === "watch") {
      for (let i = 0; i < 500; i++) {
        const keys = watched.latest?.keys.rows;

        if (
          keys?.find((r) => r.does === "tezgah.zoom")?.keys[0]?.key === request.left &&
          keys?.find((r) => r.does === "tezgah.fold")?.keys[0]?.key === request.right
        ) {
          break;
        }

        await Effect.runPromise(Effect.sleep("10 millis"));
      }

      write({
        seen:
          watched.latest?.keys.rows.find((r) => r.does === "tezgah.zoom")?.keys[0]?.key === request.left &&
          watched.latest?.keys.rows.find((r) => r.does === "tezgah.fold")?.keys[0]?.key === request.right,
      });
    } else {
      const edit =
        request.type === "undo"
          ? Edit.cases.undo.make({ version: request.version })
          : Edit.cases.bind.make({ does: request.does, keys: [request.key] });
      const result = await Effect.runPromise(
        manager.edit(edit, { how: "pressed", window: `worker-${process.pid}`, said: 1 }).pipe(Effect.result),
      );
      write(
        Result.isFailure(result)
          ? { refused: true }
          : { version: result.success.version, at: result.success.changes.at(-1)?.at },
      );
    }
  }
} finally {
  await Effect.runPromise(Scope.close(scope, Exit.void));
}
