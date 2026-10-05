import { Cmd } from "@demlik/tea";
import { z } from "zod";
import { RawIssue } from "./issue.ts";

// What the pipeline reads from where tickets live. Each read is a Cmd, so the
// machine asks for it, a restart asks again, and the `Tracker` service behind
// it can be GitHub, another tracker, a folder of files or a script.

/** A comment as the tracker hands it over. `id` is the tracker's, stable across reads. */
export const Comment = z.object({ id: z.string(), text: z.string() });
export type Comment = z.infer<typeof Comment>;

/** Read one ticket as it was filed. Triage starts from this. */
export const fetchTicket = Cmd.define("fetch_ticket", {
  input: z.object({ issue: z.string() }),
  ok: RawIssue,
  err: ["tracker_failed"],
});

/** Read every comment on a ticket so far, oldest first. */
export const fetchComments = Cmd.define("fetch_comments", {
  input: z.object({ issue: z.string() }),
  ok: z.object({ comments: z.array(Comment).readonly() }),
  err: ["tracker_failed"],
});
