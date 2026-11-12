import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Pinned, pinLine, pinnedScript, pinState, pinText } from "./pin.ts";

const commit = fc.stringMatching(/^[0-9a-f]{40}$/);
const folder = fc.string({ minLength: 1 });
const pinned = fc.record({ commit, folder }).map((p) => Pinned.make(p));

describe("pinState", () => {
  it("a pin read back from its own text is the same pin", () =>
    fc.assert(
      fc.property(pinned, (pin) => {
        expect(pinState(pinText(pin))).toEqual({ _tag: "pinned", pin });
      }),
    ));

  it("no value is unpinned, and only no value", () => {
    expect(pinState(undefined)).toEqual({ _tag: "unpinned" });
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(pinState(value)._tag).not.toBe("unpinned");
      }),
    );
  });

  it("a value that does not parse is malformed and keeps the value, never read as a pin", () =>
    fc.assert(
      fc.property(fc.string(), (value) => {
        const state = pinState(value);
        // A string is a pin only when it is a pin's own text.
        fc.pre(state._tag !== "pinned");
        expect(state).toEqual({ _tag: "malformed", value });
      }),
    ));

  it("pinned: a commit that is not 40 hex characters does not parse", () =>
    fc.assert(
      fc.property(
        fc.string().filter((c) => !/^[0-9a-f]{40}$/.test(c)),
        folder,
        (bad, at) => {
          expect(pinState(JSON.stringify({ commit: bad, folder: at }))._tag).toBe("malformed");
        },
      ),
    ));
});

describe("pinnedScript", () => {
  it("pinned: a lead script sits in the pin where it sits in the main checkout", () => {
    expect(pinnedScript("/b/pins/p1.7", "x.ts")).toBe("/b/pins/p1.7/.agents/skills/lead/scripts/x.ts");
  });
});

describe("pinLine", () => {
  it("names the pin's short commit and folder, on one line", () =>
    fc.assert(
      fc.property(fc.option(pinned, { nil: undefined }), pinned, (before, now) => {
        const line = pinLine(before, now);
        expect(line).toContain(now.commit.slice(0, 12));
        expect(line).toContain(now.folder);
        fc.pre(!now.folder.includes("\n"));
        expect(line).not.toContain("\n");
      }),
    ));

  it("a restart on another commit names the commit the last process ran on", () =>
    fc.assert(
      fc.property(pinned, pinned, (before, now) => {
        fc.pre(before.commit.slice(0, 12) !== now.commit.slice(0, 12));
        expect(pinLine(before, now)).toContain(`last process ran on ${before.commit.slice(0, 12)}`);
      }),
    ));

  it("scenario: a restart on the same commit says so, and a first start says it is the first", () => {
    const pin = Pinned.make({ commit: "a".repeat(40), folder: "/b/pins/p1.7" });
    expect(pinLine(pin, { ...pin, folder: "/b/pins/p1.8" })).toContain("the same commit");
    expect(pinLine(undefined, pin)).toContain("first pinned process");
  });
});
