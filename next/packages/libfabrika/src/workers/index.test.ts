import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as fc from "fast-check";
import { workerLoader } from "./index.ts";

const unexpected = () => {
  throw new Error("unknown program reached Worker Loader");
};

it("an unknown program is refused before the Worker Loader is called", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), fc.string(), (name, process) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const loader = workerLoader({ get: unexpected, load: unexpected }, {});
          expect(yield* Effect.flip(loader.load(name, process))).toMatchObject({
            _tag: "ProgramDown",
            reason: "no_program",
          });
        }),
      ),
    ),
    { seed: 119120, examples: [["missing", "process-test"]] },
  );
});
