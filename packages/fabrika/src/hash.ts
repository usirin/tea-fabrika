import { Effect } from "effect";

// RFC 8785: UTF-16 key order, ECMAScript numbers, no Unicode normalization.
const canonical = (value: unknown, parents = new Set<object>()): string => {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    if (/[\uD800-\uDFFF]/u.test(value)) {
      throw new Error("JSON text contains an unpaired surrogate");
    }

    return JSON.stringify(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }

  if (typeof value !== "object" || value === null) {
    throw new Error("Not JSON data");
  }

  if (parents.has(value)) {
    throw new Error("JSON data contains a cycle");
  }

  parents.add(value);

  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (item) => canonical(item, parents)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Not a JSON object");
    }

    return `{${Object.keys(value)
      .sort()
      .map((key) => `${canonical(key, parents)}:${canonical(Reflect.get(value, key), parents)}`)
      .join(",")}}`;
  } finally {
    parents.delete(value);
  }
};

/** Canonical JSON hashed with Web Crypto on Node, workers, and browsers. */
export const hash = (value: unknown): Effect.Effect<string, Error> =>
  Effect.try({
    try: () => canonical(value),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(
    Effect.flatMap((text) =>
      Effect.tryPromise({
        try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    ),
    Effect.map(
      (bytes) => `sha256:${Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")}`,
    ),
  );
