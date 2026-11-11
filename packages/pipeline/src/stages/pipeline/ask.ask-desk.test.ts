import { rmSync } from "node:fs";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Asked } from "../../tickets/ask.ts";
import { lane, made, runsOf } from "./lane-harness.ts";

// P2. Exercise the real lane with the existing free, local agent stand-ins.
afterEach(() => {
  vi.unstubAllEnvs();

  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ask desk P2: seal before showing the question", () => {
  // scenario: a real lane starts local agent processes and writes a real temporary repository.
  it("scenario: the first observable asked fact is complete, and restarting the wait cannot rewrite it", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const ran = await lane({ within: 50, leave: ["approve"], again: [{}], fold: true });
    const asks = ran.facts.filter((f) => f.type === "asked");
    expect(asks).toHaveLength(1);
    const ask = asks[0];
    expect(Schema.is(Asked)(ask)).toBe(true);
    expect(ask).toMatchObject({ format: 1, step: "plan", for: "approve" });
    expect(ask?.saw).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(ask?.rec).toBeDefined();
    expect(ask?.shows).toBeDefined();
    expect(runsOf(ran, "plan")).toHaveLength(1);
    expect(ran.facts.filter((f) => f.type === "answered")).toEqual([]);
  });
});
