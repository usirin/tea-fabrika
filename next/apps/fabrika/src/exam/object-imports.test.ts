// T502 PR 2, next/. The installed no-restricted-imports rule handles this shape.
import { it, expect } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { plant } from "./plant.ts";

it.effect.prop(
  "object contracts load only Alchemy; erased types do not load services",
  { module: Schema.Literals(["./runtime.ts", "./record.ts", "effect", "node:fs"]) },
  ({ module }) =>
    Effect.gen(function* () {
      const file = "next/packages/libfabrika/src/workers/objects.ts";
      const fires = yield* Effect.promise(() =>
        plant({
          [file]: [
            `import { value } from ${JSON.stringify(module)};`,
            `import type { Shape } from ${JSON.stringify(module)};`,
            'import * as Cloudflare from "@alchemy.run/cloudflare";',
            'import type { Other } from "./runtime.ts";',
            'import { type Mixed } from "./runtime.ts";',
            'import "./runtime.ts";',
            "export { value, Cloudflare }; export type { Shape, Other, Mixed };",
          ].join("\n"),
        }),
      );
      expect([...new Set(fires("eslint(no-restricted-imports)", file))]).toEqual([1, 6]);
    }),
  { arbitrary: { seed: 119120, runs: 4 } },
);
