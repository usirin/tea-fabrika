import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { callJob, type Heads, KEYFRAME, keepSpans, migrateJob } from "./job-rules.ts";
import type { SpanRow } from "./otlp.ts";
import { connect } from "./sqlite-driver.ts";
import { RecordRead } from "./traces.ts";

// Who may delete an agent run's content (docs/direction/an-agent-run-keeps-its-content.md): a
// person, never an agent. The door stamps every call with who sent it; a `deleteContent` stamped
// with anyone but a user is refused, and the content stays as it was. Run on node:sqlite, with the
// SQL the Durable Object runs. Today's version.

const CHAT = "7f2c00000000000b";

const chat: SpanRow = {
  span: CHAT,
  parent: null,
  name: "chat",
  service: "build",
  start: 840,
  end: 900,
  status: "ok",
  tags: {
    "gen_ai.operation.name": "chat",
    "langfuse.observation.input": '{"input":"Build it."}',
    "langfuse.observation.output": '{"content":"I read the file."}',
  },
  events: [],
};

const kept = { span: CHAT, input: '{"input":"Build it."}', output: '{"content":"I read the file."}' };

const record = () => {
  const { db, close } = connect(":memory:");
  migrateJob(db);
  const heads: Heads = new Map();
  keepSpans(db, [chat], "agent:otel");
  const read = () =>
    Schema.decodeUnknownSync(RecordRead)(callJob(db, heads, { op: "read" }, "user:owner", 6000, KEYFRAME));
  const remove = (by: string) =>
    callJob(db, heads, { op: "deleteContent", span: CHAT, why: "a key was read" }, by, 5000, KEYFRAME);
  return { close, read, remove };
};

describe("deleting an agent run's content", () => {
  it.each(["agent:lane for:owner", "agent:otel"])("is refused to %s, and the content stays", (by) => {
    const { close, read, remove } = record();
    expect(remove(by)).toEqual({ error: `only a person deletes content, and ${by} is not one` });
    expect(read().content).toEqual([kept]);
    close();
  });

  it("is a person's to do: the words go, and who, when and why stay", () => {
    const { close, read, remove } = record();
    expect(remove("user:owner")).toBeNull();
    expect(read().content).toEqual([{ span: CHAT, deleted: { by: "user:owner", at: 5000, why: "a key was read" } }]);
    // The span itself stays, with its names and ids.
    expect(read().spans.map((s) => s.span)).toEqual([CHAT]);
    close();
  });
});
