import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { jevFailureReader } from "./route.ts";
import { FailureReader, Jev } from "./services.ts";
import { DEFAULT_SETTINGS, Settings, settingsFromToml } from "./settings.ts";

const read = (text: string) =>
  Effect.runPromise(
    settingsFromToml(text).pipe(Effect.match({ onSuccess: (right) => ({ right }), onFailure: (left) => ({ left }) })),
  );

describe("fabrika.toml", () => {
  it("gives today's values when it is empty", async () => {
    expect(await read("")).toEqual({ right: DEFAULT_SETTINGS });
    expect(DEFAULT_SETTINGS).toMatchObject({
      jev: { retries: 3 },
      review: { route_floor: 0.8, match_floor: 0.9 },
      comments: { floor: 0.8, no_change_floor: 0.9 },
      failure: { floor: 0.8, output_chars: 20_000, diff_chars: 20_000 },
    });
  });

  it("changes only the keys it names", async () => {
    const text = ["[failure]", "floor = 0.9", "", "[jev]", "retries = 1"].join("\n");

    expect(await read(text)).toEqual({
      right: {
        ...DEFAULT_SETTINGS,
        jev: { ...DEFAULT_SETTINGS.jev, retries: 1 },
        failure: { ...DEFAULT_SETTINGS.failure, floor: 0.9 },
      },
    });
  });

  it("refuses a value out of range, and says which key", async () => {
    const result = await read("[failure]\nfloor = 1.5\n");

    expect(result).toMatchObject({ left: { _tag: "settings_invalid" } });
    expect(JSON.stringify(result)).toContain("failure.floor");
  });

  it("refuses a key it does not know, so a typo is not ignored", async () => {
    expect(await read("[failure]\nflor = 0.9\n")).toMatchObject({ left: { _tag: "settings_invalid" } });
    expect(await read("[falure]\nfloor = 0.9\n")).toMatchObject({ left: { _tag: "settings_invalid" } });
  });

  it("refuses a file that is not TOML", async () => {
    const result = await read("[failure\nfloor = = 0.9");

    expect(result).toMatchObject({ left: { _tag: "settings_invalid" } });
    expect(JSON.stringify(result)).toContain("not TOML");
  });
});

/** A Jev that says the test file broke the run, this sure. */
const jevSaying = (confidence: number) =>
  Layer.succeed(Jev, {
    call: (request) =>
      Effect.succeed({
        status: 200,
        body: {
          model: request.model,
          answers: {
            cause: {
              type: "choice",
              choice: "test_file",
              confidence,
              probabilities: { change: 1 - confidence, test_file: confidence, environment: 0 },
            },
          },
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
  });

const causeWith = (toml: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const settings = yield* settingsFromToml(toml);
      const reader = Layer.provide(jevFailureReader, Layer.mergeAll(jevSaying(0.85), Layer.succeed(Settings, settings)));
      return yield* Effect.gen(function* () {
        return yield* (yield* FailureReader).read({ command: "node --test", diff: "", output: "SyntaxError" });
      }).pipe(Effect.provide(reader));
    }),
  );

describe("a floor from the file", () => {
  it("decides whether a failure parks: test_file at 0.85 parks by default, and is sent back under a 0.9 floor", async () => {
    // A sure test_file parks the lane for a person; unsure goes back to the builder (lane.test.ts).
    expect(await causeWith("")).toMatchObject({ cause: "test_file" });
    expect(await causeWith("[failure]\nfloor = 0.9\n")).toMatchObject({ cause: "unsure" });
  });
});
