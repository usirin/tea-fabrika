import { describe, expect, it } from "vitest";
import { CONTENT, cutTag } from "./otlp.ts";

// How a record cuts a tag's text (./otlp.ts): any tag at 1,024 characters (`MAX_TAG`), and the two
// tags that hold an agent run's content at a far larger most, since a job's record keeps them in
// its own `content` table.

/** `MAX_TAG` in ./otlp.ts. */
const MAX_TAG = 1024;

const LONG = "a".repeat(2000);

describe("a tag as a record keeps it", () => {
  it("keeps a short tag exactly as sent", () => {
    expect(cutTag("gen_ai.tool.name", "Read")).toBe("Read");
    expect(cutTag(CONTENT.output, "Read a.")).toBe("Read a.");
    expect(cutTag("gen_ai.usage.input_tokens", 120)).toBe(120);
  });

  it("cuts a long plain tag at `MAX_TAG`, and says it was cut", () => {
    expect(cutTag("gen_ai.tool.name", LONG)).toBe(`${"a".repeat(MAX_TAG)}…`);
  });

  it("keeps a long input or output whole", () => {
    expect(cutTag(CONTENT.output, LONG)).toBe(LONG);
    expect(cutTag(CONTENT.input, LONG)).toBe(LONG);
  });
});
