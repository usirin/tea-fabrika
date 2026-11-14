/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { Id } from "@kampus/libfabrika";
import { mount, startWindow } from "@kampus/tuval";
import { browserKey, browserRows, browserSocket } from "@kampus/tuval/browser";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { Effect, Layer } from "effect";
import { tiles, window, windowFor } from "./views.ts";

const page = Effect.scoped(
  Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
