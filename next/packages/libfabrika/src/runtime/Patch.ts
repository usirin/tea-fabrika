// View patches, next/: the RFC 6902 operations that turn one JSON view into the next (Tier 1, P11,
// law p22). A watcher gets the whole view once, then a patch per step. Pure, and it never changes
// its inputs.
import { Result, Schema } from "effect";

/** One RFC 6902 operation. `add`, `remove` and `replace` are all a view diff needs. */
export type Patch =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown };

/** A JSON Pointer token: `~` as `~0`, `/` as `~1` (RFC 6901). */
const token = (key: string | number): string => String(key).replaceAll("~", "~0").replaceAll("/", "~1");

type Plain = { [key: string]: unknown };

const isPlain = (u: unknown): u is Plain => typeof u === "object" && u !== null && !Array.isArray(u);

/** Same JSON value: `Object.is` for leaves, so `0` and `-0` differ as they do to a watcher. */
const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((one, i) => same(one, b[i]));
  }

  if (isPlain(a) && isPlain(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
  }

  return Object.is(a, b);
};

const walk = (path: string, before: unknown, after: unknown, out: Array<Patch>): void => {
  if (same(before, after)) {
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const common = Math.min(before.length, after.length);

    for (let i = 0; i < common; i++) {
      walk(`${path}/${i}`, before[i], after[i], out);
    }

    for (let i = common; i < after.length; i++) {
      out.push({ op: "add", path: `${path}/${i}`, value: structuredClone(after[i]) });
    }

    for (let i = before.length - 1; i >= common; i--) {
      out.push({ op: "remove", path: `${path}/${i}` });
    }

    return;
  }

  if (isPlain(before) && isPlain(after)) {
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) {
        out.push({ op: "remove", path: `${path}/${token(key)}` });
      }
    }

    for (const [key, value] of Object.entries(after)) {
      const at = `${path}/${token(key)}`;

      if (Object.hasOwn(before, key)) {
        walk(at, before[key], value, out);
      } else {
        out.push({ op: "add", path: at, value: structuredClone(value) });
      }
    }

    return;
  }

  out.push({ op: "replace", path, value: structuredClone(after) });
};

/** The patches that turn `before` into `after`, in the order to apply them. None when equal. */
export const diff = (before: unknown, after: unknown): ReadonlyArray<Patch> => {
  const out: Array<Patch> = [];
  walk("", before, after, out);
  return out;
};

const Operation = Schema.Union([
  Schema.Struct({ op: Schema.Literal("add"), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal("replace"), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal("remove"), path: Schema.String }),
]);

const decodeOps = Schema.decodeUnknownResult(Schema.Array(Operation));
const decodeJson = Schema.decodeUnknownResult(Schema.Json);
const unsafe = new Set(["__proto__", "constructor", "prototype"]);
const invalid = () => Result.fail("bad_patch" as const);

/** Applies the view protocol's RFC 6902 subset to a copy. A rejected patch changes nothing. */
export const apply = (before: unknown, ops: unknown): Result.Result<Schema.Json, "bad_patch"> => {
  const decoded = decodeOps(ops);
  const json = decodeJson(before);

  if (Result.isFailure(decoded) || Result.isFailure(json)) {
    return invalid();
  }

  let root = structuredClone(json.success);

  for (const op of decoded.success) {
    if (op.path !== "" && !op.path.startsWith("/")) {
      return invalid();
    }

    const encoded = op.path === "" ? [] : op.path.slice(1).split("/");

    if (encoded.some((p) => /~(?![01])/.test(p))) {
      return invalid();
    }

    const path = encoded.map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"));

    if (path.some((p) => unsafe.has(p))) {
      return invalid();
    }

    if (path.length === 0) {
      root = op.op === "remove" ? null : structuredClone(op.value);
      continue;
    }

    let parent: Schema.Json = root;

    for (const part of path.slice(0, -1)) {
      if (Array.isArray(parent)) {
        if (!/^(0|[1-9][0-9]*)$/.test(part) || Number(part) >= parent.length) {
          return invalid();
        }

        parent = parent[Number(part)] ?? null;
      } else if (isPlain(parent) && Object.hasOwn(parent, part)) {
        parent = parent[part] as Schema.Json;
      } else {
        return invalid();
      }
    }

    const key = path.at(-1) ?? "";

    if (Array.isArray(parent)) {
      const index = key === "-" && op.op === "add" ? parent.length : /^(0|[1-9][0-9]*)$/.test(key) ? Number(key) : -1;

      if (index < 0 || index >= parent.length + (op.op === "add" ? 1 : 0)) {
        return invalid();
      }

      if (op.op === "remove") {
        parent.splice(index, 1);
      } else if (op.op === "add") {
        parent.splice(index, 0, structuredClone(op.value));
      } else {
        parent[index] = structuredClone(op.value);
      }
    } else if (isPlain(parent)) {
      if (op.op !== "add" && !Object.hasOwn(parent, key)) {
        return invalid();
      }

      if (op.op === "remove") {
        delete parent[key];
      } else {
        parent[key] = structuredClone(op.value);
      }
    } else {
      return invalid();
    }
  }

  return Result.succeed(root);
};
