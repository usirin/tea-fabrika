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
      const { diff } = await import("./Patch.ts");
      const copy = structuredClone(before);
      expect(apply(before, diff(before, after))).toEqual(after);
      expect(before).toEqual(copy);
    });
  }

  it("plant, compare only objects: every JSON pair and a chain of watcher bases reconstructs", async () => {
    const { diff } = await import("./Patch.ts");
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
    const { diff } = await import("./Patch.ts");
    const value = { rows: [{ id: 1, title: "a/b~" }], count: 3 };
    expect(diff(value, structuredClone(value))).toEqual([]);
  });
});

// P14 slice 2, next/ (ticket 828): laws L6 and L7 of the approved plan, written before `apply`. The shape
// they hold `Patch.ts` to: `apply(before, ops)` takes a view and the operations as they arrived
// (unknown) and answers `Result.succeed(after)`, or `Result.fail(PatchError)` when any part is
// malformed, a pointer is not RFC 6901, a key is `__proto__`, `constructor` or `prototype`, or a target
// is not there. It never changes `before` or `ops`.

type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json };

/** The paths `value` holds now, as pointer tokens, the root included. */
const paths = (value: unknown, at: ReadonlyArray<string> = []): Array<ReadonlyArray<string>> => {
  const out: Array<ReadonlyArray<string>> = [at];

  if (Array.isArray(value)) {
    for (const [i, one] of value.entries()) {
      out.push(...paths(one, [...at, String(i)]));
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [key, one] of Object.entries(value)) {
      out.push(...paths(one, [...at, key]));
    }
  }

  return out;
};

const read = (value: unknown, at: ReadonlyArray<string>): unknown =>
  at.reduce<unknown>((v, key) => (typeof v === "object" && v !== null ? Reflect.get(v, key) : undefined), value);

/** `value` with `f` done to the container at `at`, copied on the way down. */
const change = (value: unknown, at: ReadonlyArray<string>, f: (v: unknown) => unknown): unknown => {
  const [key, ...rest] = at;

  if (key === undefined) {
    return f(value);
  }

  if (Array.isArray(value)) {
    const copy = [...value];
    copy[Number(key)] = change(copy[Number(key)], rest, f);
    return copy;
  }

  return { ...(value as Record<string, unknown>), [key]: change(Reflect.get(Object(value), key), rest, f) };
};

/** One generated edit: which path the value holds now, and what to do there. */
const editChoice = fc.record({
  pick: fc.nat(),
  kind: fc.nat(),
  key: fc.string({ maxLength: 4 }),
  value: fc.jsonValue({ maxDepth: 2 }),
});

type EditChoice = typeof editChoice extends fc.Arbitrary<infer E> ? E : never;

/** `before` changed by edits chosen from the paths it holds at each step: replace a value, drop a key or
 *  an item, or add one. */
const edited = (before: unknown, edits: ReadonlyArray<EditChoice>): unknown =>
  edits.reduce((value, e) => {
    const all = paths(value);
    const at = all[e.pick % all.length]!;
    const here = read(value, at);

    if (e.kind % 3 === 0 || at.length === 0) {
      return change(value, at, () => e.value);
    }

    const parent = at.slice(0, -1);
    const last = at.at(-1)!;

    if (e.kind % 3 === 1) {
      return change(value, parent, (p) =>
        Array.isArray(p)
          ? p.filter((_, i) => String(i) !== last)
          : Object.fromEntries(Object.entries(Object(p)).filter(([k]) => k !== last)),
      );
    }

    return typeof here === "object" && here !== null
      ? change(value, at, (p) => (Array.isArray(p) ? [...p, e.value] : { ...Object(p), [e.key]: e.value }))
      : change(value, at, () => e.value);
  }, structuredClone(before));

const UNSAFE = ["__proto__", "constructor", "prototype"] as const;

describe("L6: apply undoes diff and never changes its inputs", () => {
  it("applying diff(before, after) to before gives after, for after derived from before by generated edits", async () => {
    const { apply, diff } = await import("./Patch.ts");
    const { Result } = await import("effect");
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(editChoice, { maxLength: 8 }), (before, edits) => {
        const after = edited(before, edits);
        // A view key that names a prototype is refused by the next law, so these pairs hold none.
        fc.pre(
          ![...paths(before), ...paths(after)].some((p) =>
            p.some((k) => (UNSAFE as ReadonlyArray<string>).includes(k)),
          ),
        );
        const ops = diff(before, after);
        const beforeCopy = structuredClone(before);
        const opsCopy = structuredClone(ops);
        const got = apply(before, ops);
        expect(Result.isSuccess(got)).toBe(true);
        expect(Result.getOrThrow(got)).toEqual(after);
        expect(before, "apply changed its view").toEqual(beforeCopy);
        expect(ops, "apply changed its ops").toEqual(opsCopy);
      }),
      { seed: 119120, numRuns: 500 },
    );
  });

  it("a path through __proto__, constructor or prototype is refused, at any depth, and nothing is polluted", async () => {
    const { apply } = await import("./Patch.ts");
    const { Result } = await import("effect");
    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.nat(),
        fc.constantFrom(...UNSAFE),
        fc.constantFrom("add", "replace", "remove"),
        fc.jsonValue({ maxDepth: 1 }),
        fc.boolean(),
        (before, pick, unsafe, op, value, last) => {
          // The unsafe key at a path this value holds, as the last token or with one more below it.
          const all = paths(before);
          const at = [...all[pick % all.length]!, unsafe, ...(last ? [] : ["polluted"])];
          const path = `/${at.map((k) => k.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
          const copy = structuredClone(before);
          const got = apply(before, [op === "remove" ? { op, path } : { op, path, value }]);
          expect(Result.isFailure(got), `${op} ${path}`).toBe(true);
          expect(before).toEqual(copy);
          expect(Reflect.get({}, "polluted"), "Object.prototype was written").toBeUndefined();
        },
      ),
      { seed: 119120, numRuns: 500 },
    );
  });
});

/** RFC 6901 section 5's document. */
const RFC6901 = {
  foo: ["bar", "baz"],
  "": 0,
  "a/b": 1,
  "c%d": 2,
  "e^f": 3,
  "g|h": 4,
  "i\\j": 5,
  'k"l': 6,
  " ": 7,
  "m~n": 8,
};

describe("L7: pointers and operations as the RFCs give them", () => {
  it("vector: RFC 6901 section 5, each pointer names the value the RFC says, read through a replace", async () => {
    const { apply } = await import("./Patch.ts");
    const { Result } = await import("effect");
    const vectors: ReadonlyArray<readonly [string, ReadonlyArray<string | number>]> = [
      ["/foo", ["foo"]],
      ["/foo/0", ["foo", 0]],
      ["/", [""]],
      ["/a~1b", ["a/b"]],
      ["/c%d", ["c%d"]],
      ["/e^f", ["e^f"]],
      ["/g|h", ["g|h"]],
      ["/i\\j", ["i\\j"]],
      ['/k"l', ['k"l']],
      ["/ ", [" "]],
      ["/m~0n", ["m~n"]],
    ];

    for (const [pointer, keys] of vectors) {
      const got = apply(RFC6901, [{ op: "replace", path: pointer, value: "X" }]);
      expect(Result.isSuccess(got), pointer).toBe(true);
      expect(read(Result.getOrThrow(got), keys.map(String)), pointer).toBe("X");
    }

    expect(Result.getOrThrow(apply(RFC6901, [{ op: "replace", path: "", value: "X" }]))).toBe("X");
    // `~01` is the key `~1`: `~1` is decoded first only by a wrong reader, which would read `/`.
    expect(Result.getOrThrow(apply({ "~1": 0, "/": 0 }, [{ op: "replace", path: "/~01", value: 1 }]))).toEqual({
      "~1": 1,
      "/": 0,
    });
    expect(
      Result.isFailure(apply(RFC6901, [{ op: "replace", path: "foo", value: 1 }])),
      "a pointer starts with /",
    ).toBe(true);
    expect(Result.isFailure(apply(RFC6901, [{ op: "replace", path: "/m~2n", value: 1 }])), "~ is ~0 or ~1 only").toBe(
      true,
    );
  });

  it("vector: RFC 6902 appendix A, the add, remove and replace examples and their errors", async () => {
    const { apply } = await import("./Patch.ts");
    const { Result } = await import("effect");
    const ok: ReadonlyArray<readonly [string, Json, ReadonlyArray<unknown>, Json]> = [
      [
        "A.1 adding an object member",
        { foo: "bar" },
        [{ op: "add", path: "/baz", value: "qux" }],
        { baz: "qux", foo: "bar" },
      ],
      [
        "A.2 adding an array element",
        { foo: ["bar", "baz"] },
        [{ op: "add", path: "/foo/1", value: "qux" }],
        { foo: ["bar", "qux", "baz"] },
      ],
      ["A.3 removing an object member", { baz: "qux", foo: "bar" }, [{ op: "remove", path: "/baz" }], { foo: "bar" }],
      [
        "A.4 removing an array element",
        { foo: ["bar", "qux", "baz"] },
        [{ op: "remove", path: "/foo/1" }],
        { foo: ["bar", "baz"] },
      ],
      [
        "A.5 replacing a value",
        { baz: "qux", foo: "bar" },
        [{ op: "replace", path: "/baz", value: "boo" }],
        { baz: "boo", foo: "bar" },
      ],
      [
        "A.10 adding a nested member object",
        { foo: "bar" },
        [{ op: "add", path: "/child", value: { grandchild: {} } }],
        { foo: "bar", child: { grandchild: {} } },
      ],
      [
        "A.11 ignoring unrecognized elements",
        { foo: "bar" },
        [{ op: "add", path: "/baz", value: "qux", xyz: 123 }],
        { foo: "bar", baz: "qux" },
      ],
      [
        "A.16 adding an array value",
        { foo: ["bar"] },
        [{ op: "add", path: "/foo/-", value: ["abc", "def"] }],
        { foo: ["bar", ["abc", "def"]] },
      ],
    ];

    for (const [label, before, ops, after] of ok) {
      const got = apply(before, ops);
      expect(Result.isSuccess(got), label).toBe(true);
      expect(Result.getOrThrow(got), label).toEqual(after);
    }

    // A.12: adding to a nonexistent target is an error, and so is any operation the client does not take.
    expect(Result.isFailure(apply({ foo: "bar" }, [{ op: "add", path: "/baz/bat", value: "qux" }])), "A.12").toBe(true);
    expect(
      Result.isFailure(apply({ foo: "bar" }, [{ op: "move", from: "/foo", path: "/bar" }])),
      "move is not taken",
    ).toBe(true);
    expect(Result.isFailure(apply({ foo: "bar" }, [{ op: "remove", path: "/nothere" }])), "remove needs a target").toBe(
      true,
    );
    expect(
      Result.isFailure(apply({ foo: [1] }, [{ op: "replace", path: "/foo/01", value: 2 }])),
      "an index has no leading zero",
    ).toBe(true);
    expect(Result.isFailure(apply({ foo: "bar" }, { op: "add" })), "ops are a list").toBe(true);
  });
});
