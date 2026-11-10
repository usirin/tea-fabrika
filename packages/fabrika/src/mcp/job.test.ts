import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BYTES_MAX, JOB, LAST_MAX, lastLines } from "./job.ts";

// The `job` tool's answer holds a job's last lines, as tmux's `capture-pane -S -<n>` and
// `docker logs --tail <n>` give them: the newest last, never more than `last`, and never more
// bytes than `BYTES_MAX`, whatever the job printed. Today's version. The field is `last`, not
// `tail`: here "the tail" already means the ledger's live stream.
//
//   lastLines(["1", "2", "3", "4", "5"], 2)    // ["4", "5"]
//   lastLines([], 10)                          // []
//   lastLines(["a".repeat(BYTES_MAX * 2)], 1)  // [the line's start, cut to fit]
//
// The bytes are counted as the lines go out: UTF-8, one newline after each.

const OPTS = { numRuns: 300, seed: 119120 };

const bytesOf = (lines: readonly string[]): number =>
  lines.reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0);

/** A high surrogate with no low one after it, or a low one with no high one before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A printed line: short, and any text a program could print, a long code point included. */
const arbLine = fc.string({ maxLength: 80, unit: "binary" });

describe("a job's last lines", () => {
  it("is a host tool named job, beside runs", () => {
    expect(JOB).toBe("job");
  });

  it("caps the bytes under what an MCP client takes whole", () => {
    // Claude Code warns when one MCP tool's output passes 10,000 tokens (code.claude.com/docs/en/mcp,
    // read 2026-11-03), and saves a text over 50,000 characters to a file. A Claude token is about
    // 3.5 English characters (Anthropic's glossary), so 10,000 tokens is about 35,000 bytes of ASCII.
    expect(Number.isInteger(BYTES_MAX)).toBe(true);
    expect(BYTES_MAX).toBeGreaterThan(0);
    expect(BYTES_MAX).toBeLessThanOrEqual(35_000);
    expect(Number.isInteger(LAST_MAX)).toBe(true);
    expect(LAST_MAX).toBeGreaterThan(0);
  });

  it("is exactly the last n lines, in order, when they fit", () => {
    fc.assert(
      fc.property(fc.array(arbLine, { maxLength: 200 }), fc.integer({ min: 1, max: 200 }), (printed, wanted) => {
        const last = Math.min(wanted, LAST_MAX);
        fc.pre(bytesOf(printed.slice(-last)) <= BYTES_MAX);
        expect(lastLines(printed, last)).toEqual(printed.slice(-last));
      }),
      OPTS,
    );
  });

  it("never passes n lines or the byte cap, keeps the newest, and cuts only a line too long alone", () => {
    const arbAny = fc.oneof(
      { weight: 3, arbitrary: arbLine },
      { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 40_000, unit: "binary" }) },
    );
    fc.assert(
      fc.property(fc.array(arbAny, { maxLength: 30 }), fc.integer({ min: 1, max: LAST_MAX }), (printed, last) => {
        const got = lastLines(printed, last);
        expect(got.length).toBeLessThanOrEqual(Math.min(last, printed.length));
        expect(bytesOf(got)).toBeLessThanOrEqual(BYTES_MAX);

        // Something of the newest line always shows: a job that printed shows it printed.
        if (printed.length > 0) {
          expect(got.length).toBeGreaterThanOrEqual(1);
        }

        for (const line of got) {
          expect(line).not.toMatch(LONE_SURROGATE);
        }

        const from = printed.length - got.length;

        if (got.length === 1) {
          // Alone, the newest line may be cut at its end, as a terminal shows its start.
          expect(printed[from]?.startsWith(got[0] ?? "")).toBe(true);
        } else {
          // Several: whole lines, the newest ones, as printed.
          expect(got).toEqual(printed.slice(from));
        }

        // It stopped only where the next older line would not fit.
        if (got.length >= 1 && got.length < Math.min(last, printed.length) && got[0] === printed[from]) {
          expect(bytesOf([printed[from - 1] ?? "", ...got])).toBeGreaterThan(BYTES_MAX);
        }
      }),
      OPTS,
    );
  });
});
