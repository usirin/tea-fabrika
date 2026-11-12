// P19 L13, next/. No native work occurs without explicit host opt-in.
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { Digest } from "effect/crypto";
import { expect, it } from "vitest";
import * as Host from "./node/P19Launchd.test-support.ts";

const enabled = process.platform === "darwin" && process.env.FABRIKA_P19_HOST === "1" && !process.env.CI;

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
