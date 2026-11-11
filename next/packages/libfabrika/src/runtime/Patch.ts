// View patches, next/: the RFC 6902 operations that turn one JSON view into the next (Tier 1, P11,
// law p22). A watcher gets the whole view once, then a patch per step. Pure, and it never changes
// its inputs.

/** One RFC 6902 operation. `add`, `remove` and `replace` are all a view diff needs. */
export type Patch =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown };

/** A JSON Pointer token: `~` as `~0`, `/` as `~1` (RFC 6901). */
const token = (key: string | number): string => String(key).replaceAll("~", "~0").replaceAll("/", "~1");

type Plain = { readonly [key: string]: unknown };

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
