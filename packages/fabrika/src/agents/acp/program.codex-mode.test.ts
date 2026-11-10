import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { Cause, Effect, Option } from "effect";
import { expect, it, vi } from "vitest";
import { start } from "../../program/program.ts";
import { memoryStorage } from "../../program/storage.ts";
import { harnessOf } from "./harness.ts";
import { acpProgram } from "./program.ts";

// Stop before a process or a login is opened. Keep the program's mode selection real.
vi.mock("./harness.ts", async (original) => {
  const actual = await original<typeof import("./harness.ts")>();
  return {
    ...actual,
    harnessOf: vi.fn((...args: Parameters<typeof actual.harnessOf>) => ({
      ...actual.harnessOf("fake", args[1], null),
      prepare: Effect.fail("stopped before opening the adapter"),
    })),
  };
});

it("accepts workspace-write and selects a writable codex harness", async () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "acp-mode-")));

  try {
    const end = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* start(
          acpProgram,
          {
            agent: "codex",
            folder,
            model: undefined,
            effort: undefined,
            mode: "workspace-write",
            permissions: undefined,
            reopen: undefined,
            budget: undefined,
          },
          {},
          { id: "acp:writable", storage: memoryStorage() },
        );

        if (started.kind !== "running") {
          return yield* Effect.die("acp did not start");
        }

        return yield* started.run.ended;
      }).pipe(Effect.scoped, Effect.provide(nodeServices)),
    );
    expect(harnessOf).toHaveBeenCalledWith({ name: "codex", access: "write" }, folder, null);
    expect(end.kind).toBe("failed");

    if (end.kind === "failed") {
      const error = Cause.findErrorOption(end.cause);
      expect(Option.isSome(error) ? error.value : null).toMatchObject({
        message: "stopped before opening the adapter",
      });
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
