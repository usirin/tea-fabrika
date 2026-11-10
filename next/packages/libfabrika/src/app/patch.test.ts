// p22. RFC 6902 patches are checked with an independent small applicator, never patch's own apply.
import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";

type Patch = {
  readonly op: "add" | "remove" | "replace";
  readonly path: string;
  readonly value?: unknown;
};

const apply = (before: unknown, patches: ReadonlyArray<Patch>): unknown => {
  let root = structuredClone(before);

  for (const patch of patches) {
    if (patch.path === "") {
      root = structuredClone(patch.value);
      continue;
    }

    const keys = patch.path
      .slice(1)
      .split("/")
      .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
    let object = root;

    for (const key of keys.slice(0, -1)) {
      object = Reflect.get(Object(object), key);
    }

    const last = keys.at(-1)!;

    if (Array.isArray(object)) {
      const at = last === "-" ? object.length : Number(last);

      if (patch.op === "remove") {
        object.splice(at, 1);
      } else if (patch.op === "add") {
        object.splice(at, 0, structuredClone(patch.value));
      } else {
        object[at] = structuredClone(patch.value);
      }
    } else if (patch.op === "remove") {
      Reflect.deleteProperty(Object(object), last);
    } else {
      Reflect.set(Object(object), last, structuredClone(patch.value));
    }
  }

  return root;
};

describe("p22 whole view plus patches", () => {
  for (const [label, before, after] of [
    ["array removals", { rows: [1, 2, 3, 4] }, { rows: [4] }],
    ["array insertions", [1], [0, 1, 2]],
    ["one changed array item", [1, 2], [1, 3]],
    ["escaped keys", { "a/b": { "~key": 1 } }, { "a/b": { "~key": 2, "": 3 } }],
    ["null root", null, { rows: [] }],
    ["primitive root", 2, "three"],
    ["removed keys", { a: 1, b: { c: 2 } }, { b: { d: 3 } }],
  ] as const) {
    it(`plant, patch the wrong path or order: ${label}`, async () => {
      const { diff } = await import("./patch.ts");
      const copy = structuredClone(before);
      expect(apply(before, diff(before, after))).toEqual(after);
      expect(before).toEqual(copy);
    });
  }

  it("plant, compare only objects: every JSON pair and a chain of watcher bases reconstructs", async () => {
    const { diff } = await import("./patch.ts");
    fc.assert(
      fc.property(fc.array(fc.jsonValue(), { minLength: 2, maxLength: 12 }), (views) => {
        let watcher: unknown = structuredClone(views[0]);

        for (const next of views.slice(1)) {
          watcher = apply(watcher, diff(watcher, next));
          expect(watcher).toEqual(next);
        }
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
  it("plant, emit needless work: an unchanged view has no patch", async () => {
    const { diff } = await import("./patch.ts");
    const value = { rows: [{ id: 1, title: "a/b~" }], count: 3 };
    expect(diff(value, structuredClone(value))).toEqual([]);
  });
});
