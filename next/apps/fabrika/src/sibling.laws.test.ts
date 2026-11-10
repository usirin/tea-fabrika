// T502 PR 2, next/. Lead runs this outside the box; no sibling patch is installed.
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schedule } from "effect";
import { expect, it } from "vitest";
import { heldPort } from "./port.test-support.ts";

it("scenario: Ping.hit -> Pong.back -> Ping.leaf; the bare per-call lookup plant fails (A2, real workerd)", async () => {
  const source = readFileSync(join(import.meta.dirname, "sibling-objects.test-support.ts"), "utf8");
  const previous = { home: process.env.ALCHEMY_HOME, port: process.env.T502_PORT };
  process.env.DO_NOT_TRACK = "1";

  try {
    for (const bare of [false, true]) {
      const home = mkdtempSync(join(tmpdir(), "t502-s-"));
      process.env.ALCHEMY_HOME = join(home, "alchemy");

      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const port = yield* Effect.acquireRelease(heldPort(), (p) => p.release);
              process.env.T502_PORT = String(port.port);
              symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
              writeFileSync(join(home, "package.json"), JSON.stringify({ type: "module" }));
              const file = join(home, "objects.ts");
              writeFileSync(
                file,
                bare
                  ? source.replace(
                      'const reply = yield* pongs.getByName("one").back(n + 1);',
                      'const pongs = yield* Pong; const reply = yield* pongs.getByName("one").back(n + 1);',
                    )
                  : source,
              );
              const Cloudflare = yield* Effect.promise(() => import("@alchemy.run/cloudflare"));
              const Alchemy = yield* Effect.promise(() => import("alchemy"));
              const { deploy } = yield* Effect.promise(() => import("alchemy/Deploy"));
              const { localState } = yield* Effect.promise(() => import("alchemy/State/LocalState"));
              const { AlchemyContext } = yield* Effect.promise(() => import("alchemy/AlchemyContext"));
              const { ArtifactStore, createArtifactStore } = yield* Effect.promise(() => import("alchemy/Artifacts"));
              const Interaction = yield* Effect.promise(() => import("alchemy/Interaction"));
              const fixture: typeof import("./sibling-objects.test-support.ts") = yield* Effect.promise(
                () => import(pathToFileURL(file).href),
              );
              const stack = Alchemy.Stack(
                "siblings",
                { providers: Cloudflare.providers(), state: Alchemy.localState() },
                fixture.Host.pipe(Effect.asVoid, Effect.provide(fixture.default)),
              );
              yield* deploy({ stack, stage: "local", dev: true, scope: yield* Effect.scope }).pipe(
                Effect.asVoid,
                Effect.provide(localState()),
                Effect.provide(
                  Layer.mergeAll(
                    Layer.succeed(AlchemyContext, { dotAlchemy: join(home, ".alchemy"), dev: true, adopt: false }),
                    Layer.succeed(ArtifactStore, createArtifactStore()),
                    Interaction.layerNonInteractive(),
                  ),
                ),
              );
              const reply = yield* Effect.tryPromise(() => fetch(`http://127.0.0.1:${port.port}`)).pipe(
                Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
              );
              const body = yield* Effect.promise(() => reply.text());
              expect(reply.ok).toBe(!bare);
              expect(bare ? body : JSON.parse(body)).toEqual(
                bare ? expect.stringContaining("Pong") : { path: ["ping.hit", "pong.back", "ping.leaf"], n: 3 },
              );
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        );
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  } finally {
    for (const [key, value] of [
      ["ALCHEMY_HOME", previous.home],
      ["T502_PORT", previous.port],
    ]) {
      if (value === undefined) {
        delete process.env[key!];
      } else {
        process.env[key!] = value;
      }
    }
  }
});
