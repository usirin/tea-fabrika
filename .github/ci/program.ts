// Today's CI for both versions: whether a changed file is the same program on both sides. A stub
// the tests step wrote so program.test.ts is red for the missing rule, not a missing module; the
// build step writes the real code behind these signatures.
import type { parseSync } from "oxc-parser";

/** How CI runs git: the arguments, then the exit status and what it printed. */
export type Runner = (args: string[]) => { status: number | null; stdout: string };

/**
 * True only when both sides parse with no error, the two trees match once positions are dropped,
 * and no comment that was added, removed or changed looks like a tool comment. `name` gives the
 * language (`.ts` or `.tsx`). `parse` is the parser, oxc-parser's own unless a test hands one in; a
 * parser that throws is no proof.
 */
export const sameProgram = (_name: string, _before: string, _after: string, _parse?: typeof parseSync): boolean => {
  throw new Error("not built");
};

/**
 * The paths of `paths`, in their order, that are the same program at `base` and at `head`. Each
 * side is read with `git show <commit>:<path>` through `run`; a side that cannot be read is
 * missing, so a file added or deleted is left out, as is one that is not `.ts` or `.tsx`.
 */
export const samePaths = (_base: string, _head: string, _paths: readonly string[], _run: Runner): string[] => {
  throw new Error("not built");
};
