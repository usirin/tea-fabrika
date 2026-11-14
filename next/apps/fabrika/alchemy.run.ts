/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import type { settings as readSettings } from "@kampus/libfabrika/workers/runtime";
import * as Alchemy from "alchemy";
import { Config, Context, Effect, Layer, Schema } from "effect";
import type { Built } from "./src/build.ts";

/** Cloudflare's limit on one environment variable, in encoded bytes (Workers platform limits). */
const ENV_BYTES = 5 * 1024;

// A text setting the Worker receives. One at or over the limit is a config error before any deploy.
const Setting = Schema.String.check(
  Schema.makeFilter((value) => new TextEncoder().encode(value).byteLength < ENV_BYTES || "over 5 KB encoded"),
);

const setting = (value: string) =>
  Schema.decodeUnknownEffect(Setting)(value).pipe(Effect.mapError((error) => new Config.ConfigError(error)));

// The stack runs the completed brain file as it is (`bundle: false`); no code rides in its env.
export const stack = (
  built: Pick<Built, "brain">,
  checked: Effect.Success<ReturnType<typeof readSettings>>,
  local: Context.Context<never> = Context.empty(),
) =>
  Alchemy.Stack(
    "fabrika",
    {
      providers: Cloudflare.providers().pipe(Layer.provide(Layer.succeedContext(local))),
      state: Alchemy.localState(),
    },
    Effect.gen(function* () {
      const settings = checked.input;
      const instance = yield* setting(JSON.stringify(settings));
      const measurements = yield* Cloudflare.R2.Bucket("Measurements", {
        name: "fabrika-measurements",
        lifecycleRules: [],
        locks: [],
      });
      const brain = yield* Cloudflare.Workers.Worker("Brain", {
        name: settings.name,
        main: built.brain,
        bundle: false,
        compatibility: { date: "2026-10-12" },
        observability: { enabled: false },
        dev: { host: "127.0.0.1", port: checked.values.port, strictPort: true },
        env: {
          PROJECT: Cloudflare.DurableObject("Project"),
          PROCESS: Cloudflare.DurableObject("Process"),
          CONNECTION: Cloudflare.DurableObject("Connection"),
          RECORD: Cloudflare.DurableObject("RecordPart"),
          RecordPart: Cloudflare.DurableObject("RecordPart"),
          LOADER: Cloudflare.WorkerLoader(),
          MEASUREMENTS: measurements,
          INSTANCE: instance,
        },
      });
      return { url: brain.url };
    }),
  );
