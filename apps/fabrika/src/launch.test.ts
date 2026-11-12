import { readFileSync } from "node:fs";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Exit } from "effect";
import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import app from "../package.json" with { type: "json" };
import { pathsOf } from "./host/socket.ts";
import type { hidden } from "./launch.ts";
import { corner, launchOf, quietEnv } from "./launch.ts";

describe("the app's icon", () => {
  it("is a 1024 square with a clear background, as the Dock wants it", () => {
    const png = readFileSync(new URL("../icon/icon.png", import.meta.url));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // IHDR: width, height, then bit depth and color type. 8-bit RGBA is what holds clear corners.
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect([png[24], png[25]]).toEqual([8, 6]);
  });
});

// Which launch each environment asks for: a home of its own is quiet, unless asked otherwise.

describe("launchOf", () => {
  it("is the owner's with no home", () => {
    expect(launchOf({})).toEqual({ kind: "owner" });
    expect(launchOf({ FABRIKA_HOME: "" })).toEqual({ kind: "owner" });
  });

  it("is quiet on a home of its own", () => {
    expect(launchOf({ FABRIKA_HOME: "/tmp/h" })).toEqual({ kind: "quiet", home: "/tmp/h" });
  });

  it("is in the foreground on a home only when asked with 1", () => {
    expect(launchOf({ FABRIKA_HOME: "/tmp/h", FABRIKA_FOREGROUND: "1" })).toEqual({
      kind: "foreground",
      home: "/tmp/h",
    });
    expect(launchOf({ FABRIKA_HOME: "/tmp/h", FABRIKA_FOREGROUND: "0" })).toEqual({
      kind: "quiet",
      home: "/tmp/h",
    });
  });

  it("needs a home to be in the foreground: the owner's start stays the owner's", () => {
    expect(launchOf({ FABRIKA_FOREGROUND: "1" })).toEqual({ kind: "owner" });
  });
});

// Electron names the owner's home after `productName`. A new value starts the owner on an empty
// home, and their tickets look gone.
describe("the owner's home", () => {
  it("keeps its folder name when the package is renamed", () => {
    expect(app.productName).toBe("@kampus/fabrika-app");
  });
});

// A test window's launch (the plan of ticket 733): the environment it starts with, and where its
// window sits. @effect/vitest is not a dependency of today's app, so these are fast-check's
// properties. Each draws the area first and the size from what fits in it, or does not.

const runs = { seed: 119120, numRuns: 200 };

/** Env names as a shell has them, FABRIKA_FOREGROUND drawn often and FABRIKA_HOME sometimes. */
const envName = fc.oneof(
  { weight: 3, arbitrary: fc.constant("FABRIKA_FOREGROUND") },
  { weight: 1, arbitrary: fc.constantFrom("FABRIKA_HOME", "PATH", "HOME", "TMPDIR") },
  { weight: 4, arbitrary: fc.stringMatching(/^[A-Z_][A-Z0-9_]{0,11}$/) },
);

const envValue = fc.option(fc.oneof(fc.constantFrom("1", "0", ""), fc.string({ maxLength: 40 })), {
  nil: undefined,
  freq: 6,
});

const parentEnv = fc.dictionary(envName, envValue, { maxKeys: 12 });
/** A short home under /tmp, as `launch` makes one: it always fits the socket's limit. */
const shortHome = fc.string({ minLength: 1, maxLength: 24 }).map((tail) => `/tmp/fh-${tail}`);

/**
 * Any home a caller could pass: a short one, the empty one (launchOf reads it as the owner's), or
 * any bytes up to past the socket's limit.
 */
const someHome = fc.oneof(shortHome, fc.constant(""), fc.string({ unit: "binary", maxLength: 140 }));

describe("quietEnv", () => {
  // An ok env is a quiet start on that home, never foreground and never the owner's; a home it
  // cannot make quiet is refused. pinned: "" once answered ok, and launchOf read it as the owner's
  // start, so TestWindow.launch({ home: "" }) opened the owner's app.
  it("is quiet whenever it says ok, for every parent env and every home: launchOf reads it as quiet", () => {
    fc.assert(
      fc.property(parentEnv, someHome, (parent, home) => {
        const made = quietEnv(parent, home);
        expect(made.kind === "ok" ? launchOf(made.env) : { kind: "quiet", home }).toEqual({ kind: "quiet", home });
      }),
      { ...runs, examples: [[{ FABRIKA_FOREGROUND: "1" }, ""]] },
    );
  });

  it("keeps every other parent name and value as it was, and sets only FABRIKA_HOME", () => {
    fc.assert(
      fc.property(parentEnv, shortHome, (parent, home) => {
        const kept = Object.entries(parent).filter(
          ([name, value]) => value !== undefined && name !== "FABRIKA_FOREGROUND" && name !== "FABRIKA_HOME",
        );
        expect(quietEnv(parent, home)).toEqual({
          kind: "ok",
          env: { ...Object.fromEntries(kept), FABRIKA_HOME: home },
        });
      }),
      runs,
    );
  });

  // Any bytes, lengths 1 to 140, plus plain homes near the limit, so the 103rd and 104th byte of
  // the socket path are drawn often, and homes near it that a path join would shorten.
  const anyHome = fc.oneof(
    fc.string({ unit: "binary", minLength: 1, maxLength: 140 }),
    fc.string({ unit: "binary-ascii", minLength: 88, maxLength: 98 }),
    fc
      .tuple(fc.string({ unit: "grapheme-ascii", minLength: 86, maxLength: 96 }), fc.constantFrom("/", "//", "/."))
      .map(([head, tail]) => `${head}${tail}`),
  );
  const pathsDie = (home: string) => Exit.isFailure(Effect.runSyncExit(Effect.provide(pathsOf(home), NodePath.layer)));

  it("says long exactly when pathsOf would die on the home: the two agree on every home", () => {
    fc.assert(
      fc.property(anyHome, (home) => {
        expect(quietEnv({}, home)).toEqual(
          pathsDie(home) ? { kind: "long", home } : { kind: "ok", env: { FABRIKA_HOME: home } },
        );
      }),
      runs,
    );
  });
});

const area = fc.record({
  x: fc.integer({ min: -4000, max: 4000 }),
  y: fc.integer({ min: -4000, max: 4000 }),
  width: fc.integer({ min: 1, max: 8000 }),
  height: fc.integer({ min: 1, max: 8000 }),
});

/** A size no bigger than the area it is drawn for. */
const fitting = area.chain((at) =>
  fc
    .record({ width: fc.integer({ min: 1, max: at.width }), height: fc.integer({ min: 1, max: at.height }) })
    .map((size) => ({ area: at, size })),
);

/** A size larger than the area on one side or both, the other side fitting. */
const larger = area.chain((at) =>
  fc.constantFrom("width", "height", "both").chain((side) => {
    const wide = side !== "height";
    const tall = side !== "width";
    return fc
      .record({
        width: wide ? fc.integer({ min: at.width + 1, max: at.width + 4000 }) : fc.integer({ min: 1, max: at.width }),
        height: tall
          ? fc.integer({ min: at.height + 1, max: at.height + 4000 })
          : fc.integer({ min: 1, max: at.height }),
      })
      .map((size) => ({ area: at, size, wide, tall }));
  }),
);

describe("corner", () => {
  it("puts a window that fits inside the work area, touching its right and bottom edges", () => {
    fc.assert(
      fc.property(fitting, ({ area: at, size }) => {
        const { x, y } = corner(at, size);
        expect({ left: x >= at.x, top: y >= at.y, right: x + size.width, bottom: y + size.height }).toEqual({
          left: true,
          top: true,
          right: at.x + at.width,
          bottom: at.y + at.height,
        });
      }),
      runs,
    );
  });

  it("starts a window larger than the area at the area's top-left on that side, never left of or above it", () => {
    fc.assert(
      fc.property(larger, ({ area: at, size, wide, tall }) => {
        const { x, y } = corner(at, size);
        expect({ x, y }).toEqual({
          x: wide ? at.x : at.x + at.width - size.width,
          y: tall ? at.y : at.y + at.height - size.height,
        });
      }),
      runs,
    );
  });
});

// The type law: a quiet window's values allow only the hidden ones. Widen either, and
// `pnpm typecheck` fails on these lines; they do nothing at run time.
expectTypeOf<ReturnType<typeof hidden>["opacity"]>().toEqualTypeOf<0>();
expectTypeOf<ReturnType<typeof hidden>["ignoreMouse"]>().toEqualTypeOf<true>();
