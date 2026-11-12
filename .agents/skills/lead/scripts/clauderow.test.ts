import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Ticket 525, today's tooling. clauderow.py runs for real on a made-up transcript in a temp folder.
const script = join(import.meta.dirname, "clauderow.py");

type Usage = {
  readonly input: number;
  readonly write5m: number;
  readonly write1h: number;
  readonly read: number;
  readonly output: number;
};

const usage = fc.record({
  input: fc.integer({ min: 0, max: 200_000 }),
  write5m: fc.integer({ min: 0, max: 200_000 }),
  write1h: fc.integer({ min: 0, max: 200_000 }),
  read: fc.integer({ min: 0, max: 2_000_000 }),
  output: fc.integer({ min: 0, max: 60_000 }),
});

/** Run the script on one transcript whose calls all name `model`. */
const run = (model: string, calls: ReadonlyArray<Usage>) => {
  const dir = mkdtempSync(join(tmpdir(), "clauderow-"));

  try {
    const transcript = join(dir, "agent.jsonl");
    const lines = calls.map((call, index) =>
      JSON.stringify({
        type: "assistant",
        timestamp: `2026-11-10T08:00:${String(index).padStart(2, "0")}.000Z`,
        message: {
          id: `msg_${index}`,
          model,
          content: [],
          usage: {
            input_tokens: call.input,
            cache_creation_input_tokens: call.write5m + call.write1h,
            cache_creation: {
              ephemeral_5m_input_tokens: call.write5m,
              ephemeral_1h_input_tokens: call.write1h,
            },
            cache_read_input_tokens: call.read,
            output_tokens: call.output,
          },
        },
      }),
    );
    writeFileSync(transcript, `${lines.join("\n")}\n`);
    return spawnSync("python3", [script, "--run", "test-run", transcript, "test"], {
      encoding: "utf8",
      timeout: 5_000,
      env: { HOME: dir, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("clauderow.py", () => {
  // pinned: Claude Fable 5.2's list price in dollars per million tokens, as Anthropic's pricing
  // page gave it on 2026-11-10 (https://platform.claude.com/docs/en/about-claude/pricing): $8 in,
  // $10 and $16 for a 5-minute and a 1-hour cache write, $0.20 for a cache read, $40 out.
  const fable = { input: 8, write5m: 10, write1h: 16, read: 0.2, output: 40 };

  it("gives a claude-fable-5-2 row its dollars at that list price, and says the day it was read", () => {
    fc.assert(
      fc.property(fc.array(usage, { minLength: 1, maxLength: 4 }), (calls) => {
        const got = run("claude-fable-5-2", calls);
        expect(got.error).toBeUndefined();
        expect(got.status, got.stderr).toBe(0);
        const row = JSON.parse(got.stdout);
        const dollars = calls.reduce(
          (sum, call) =>
            sum +
            (call.input * fable.input +
              call.write5m * fable.write5m +
              call.write1h * fable.write1h +
              call.read * fable.read +
              call.output * fable.output) /
              1e6,
          0,
        );
        expect(row.model).toBe("claude-fable-5-2");
        expect(row.costUsd).toBeNull();
        // The row rounds to four places.
        expect(Math.abs(row.listUsd - dollars)).toBeLessThanOrEqual(0.000_06);
        expect(row.why).toContain("(https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-10)");
      }),
      { seed: 119120, numRuns: 6, endOnFailure: true },
    );
  });

  it("stops, and prints no row, on a model it has no list price for", () => {
    fc.assert(
      fc.property(usage, (call) => {
        const got = run("claude-made-up-9", [call]);
        expect(got.status).not.toBe(0);
        expect(got.stdout).toBe("");
        expect(got.stderr).toContain("no list price for 'claude-made-up-9'");
      }),
      { seed: 119120, numRuns: 3, endOnFailure: true },
    );
  });
});
