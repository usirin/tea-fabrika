import { Id } from "@kampus/libfabrika";
import { mount, startWindow } from "@kampus/tuval";
import { browserKey, browserRows, browserSocket } from "@kampus/tuval/browser";
import { Effect, Layer } from "effect";
import { tiles, window, windowFor } from "./views.ts";

const page = Effect.scoped(
  Effect.gen(function* () {
    const origin = globalThis.location.origin;
    const build = document.querySelector('meta[name="fabrika-build"]')?.getAttribute("content") ?? "unknown";
    const element = document.getElementById("root");

    if (element === null) {
      return;
    }

    const booting = yield* startWindow({ tiles, window, origin, build });
    const run = yield* booting.ready;
    yield* mount(element, { run, origin, windowFor });
    return yield* Effect.never;
  }),
).pipe(Effect.provide(Layer.mergeAll(browserKey, browserRows, browserSocket, Id.Generator.layer)));

// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the page starts its one Effect runtime outside React
Effect.runFork(page);
