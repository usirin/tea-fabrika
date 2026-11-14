// P19 L13, next/. No native work occurs without explicit host opt-in.
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { Digest } from "effect/crypto";
import { expect, it } from "vitest";
import * as Host from "./node/P19Launchd.test-support.ts";

const enabled = process.platform === "darwin" && process.env.FABRIKA_P19_HOST === "1" && !process.env.CI;

it("pinned: L13 bundles keep native dependencies resolvable outside root node_modules", async () => {
  // Review found that pnpm's transitive native dependencies were absent from the root link.
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "p19-bundle-" });
        const root = path.resolve(import.meta.dirname, "../../../..");
        const importer = path.join(home, "importer.mjs");
        const dependency = path.join(home, "native.cjs");
        yield* fs.writeFileString(dependency, "module.exports = 19;");
        // A local require-only dependency exercises the same original-importer resolution as .node files.
        yield* fs.makeDirectory(path.join(home, "node_modules/workerd"), { recursive: true });
        yield* fs.writeFileString(
          path.join(home, "node_modules/workerd/package.json"),
          JSON.stringify({ main: "../../native.cjs" }),
        );
        yield* fs.writeFileString(importer, 'export { default } from "workerd";');
        const output = path.join(home, "bundle.mjs");
        const files = yield* Host.bundle(`export { default } from ${JSON.stringify(importer)};`, output, root);
        expect(files).toHaveLength(1);
        expect(yield* fs.realPath(files[0]!)).toBe(yield* fs.realPath(dependency));
        expect(yield* fs.readFileString(output)).toContain(files[0]);

        // Compile both host entries without executing launchd, Electron or the local runtime.
        for (const [entry, name] of [
          [path.resolve(import.meta.dirname, "node/P19Launchd.test-support.ts"), "controller"],
          [path.resolve(import.meta.dirname, "../src/local-instance.ts"), "brain"],
        ] as const) {
          const compiled = path.join(home, `${name}.mjs`);
          const linked = yield* Host.bundle(`export * from ${JSON.stringify(entry)};`, compiled, root);
          expect(yield* fs.exists(compiled)).toBe(true);
          // The app's "sideEffects": false once emptied the helper's bundle, and its mains with it.
          expect(yield* fs.readFileString(compiled)).toContain(name === "controller" ? "p19:guard" : "localInstance");

          for (const file of linked) {
            expect(yield* fs.exists(file)).toBe(true);
          }
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

it.skipIf(!enabled)(
  "scenario: L13 unsigned Electron's real brain survives controller death, restarts and fully stops",
  async () => {
    // launchd, Electron's bundled Node and detached process cleanup require a GUI-domain Mac.
    // A skipped run is not L13 evidence. The host lead records readings under runs/.
    const result = await Effect.runPromise(
      Effect.scoped(Host.check()).pipe(Effect.provide([NodeServices.layer, Digest.layerWebCrypto])),
    );
    expect(result.starts).toHaveLength(4);
    expect(result.replacement).toBe(true);
    expect(result.controllerDeath).toBe(true);
    expect(result.normalExit).toBe(true);
    expect(result.leftovers).toEqual([]);
  },
);
