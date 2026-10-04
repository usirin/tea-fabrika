import { z } from "zod";

/** One acceptance criterion. The judge is asked about each one on its own. */
export const Criterion = z.object({ id: z.string(), text: z.string() });
export type Criterion = z.infer<typeof Criterion>;

/**
 * A unit of work a lane can pick up. An issue with no criteria has nothing to
 * be judged against, so the type does not allow one.
 */
export const Issue = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  criteria: z.tuple([Criterion], Criterion),
});
export type Issue = z.infer<typeof Issue>;
