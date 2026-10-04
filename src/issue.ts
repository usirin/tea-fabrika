import { z } from "zod";

/** One acceptance criterion. The judge is asked about each one on its own. */
export const Criterion = z.object({ id: z.string(), text: z.string() });
export type Criterion = z.infer<typeof Criterion>;

/**
 * A unit of work a lane can pick up. `goal` says what the code does once the
 * issue is done, as a plain fact; the title may well describe the bug instead,
 * and the judge reads a test far better beside the goal than beside the bug. An issue with no criteria has nothing to
 * be judged against, so the type does not allow one.
 */
export const Issue = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  body: z.string(),
  criteria: z.tuple([Criterion], Criterion),
});
export type Issue = z.infer<typeof Issue>;

/**
 * An issue as somebody filed it: rough words, no criteria. Triage turns one of
 * these into an {@link Issue}. Who filed it matters: triage may throw away an
 * agent's filing, never a person's.
 */
export const RawIssue = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  filedBy: z.enum(["agent", "human"]),
});
export type RawIssue = z.infer<typeof RawIssue>;
