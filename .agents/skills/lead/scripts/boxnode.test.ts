import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { firstOnPath, pinnedBin, pnpmBin } from "./boxnode.ts";

const segment = fc.stringMatching(/^[a-z0-9.]{1,8}$/);
const dir = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => `/${parts.join("/")}`);
const dirs = fc.array(dir, { maxLength: 6 });
const version = fc.tuple(fc.nat(40), fc.nat(40), fc.nat(40)).map((v) => v.join("."));

describe("firstOnPath", () => {
  it("puts the given folders first, in order, once each, and keeps every other folder in its order", () =>
    fc.assert(
      fc.property(dirs, dirs, (path, front) => {
        const out = firstOnPath(path.join(":"), front).split(":").filter(Boolean);
        const lead = [...new Set(front)];
        expect(out.slice(0, lead.length)).toEqual(lead);
        expect(out.slice(lead.length)).toEqual(path.filter((d) => !lead.includes(d)));
      }),
    ));

  it("is idempotent: pinning twice is pinning once", () =>
    fc.assert(
      fc.property(dirs, dirs, (path, front) => {
        const once = firstOnPath(path.join(":"), front);
        expect(firstOnPath(once, front)).toBe(once);
      }),
    ));
});

describe("pinnedBin", () => {
  it("is the folder of the Node that printed the pin, and null for any other version", () =>
    fc.assert(
      fc.property(dir, version, version, (bin, pin, other) => {
        expect(pinnedBin(`${bin}/node\nv${pin}\n`, pin)).toBe(bin);
        expect(pinnedBin(`${bin}/node\nv${other}\n`, pin)).toBe(other === pin ? bin : null);
      }),
    ));

  it("format: an answer that is not an absolute node path is null", () => {
    // What a missing volta, or a refusal, leaves: no stdout, or an error on stdout.
    expect(pinnedBin("", "26.13.0")).toBeNull();
    expect(pinnedBin("node\nv26.13.0", "26.13.0")).toBeNull();
    expect(pinnedBin("/a/bin/nodejs\nv26.13.0", "26.13.0")).toBeNull();
  });
});

describe("pnpmBin", () => {
  it("is the folder of a real pnpm, and null for a Volta shim folder", () =>
    fc.assert(
      fc.property(dir, (bin) => {
        expect(pnpmBin(`${bin}/pnpm\n`)).toBe(bin);
        expect(pnpmBin(`${bin}/.volta/bin/pnpm\n`)).toBeNull();
      }),
    ));

  it("format: anything but one absolute pnpm path is null", () => {
    // `volta which pnpm` with no pnpm installed prints nothing on stdout.
    expect(pnpmBin("")).toBeNull();
    expect(pnpmBin("pnpm")).toBeNull();
    expect(pnpmBin("/a/bin/pnpm\n/b/bin/pnpm")).toBeNull();
    expect(pnpmBin("/a/bin/pnpx")).toBeNull();
  });
});
