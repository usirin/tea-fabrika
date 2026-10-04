// What the test-writer is told. The three rules in the middle are the ones the
// experiments settled on: one test per criterion, assert the criterion's own
// example, and a second assertion only to make an empty test fail.
import type { Criterion } from "../src/issue.ts";
import { TEST_FILE } from "./grading.ts";

export interface WriterBrief {
  readonly title: string;
  /** The file the function under test lives in. */
  readonly file: string;
  readonly fn: string;
  readonly criteria: readonly Criterion[];
}

export const writerPrompt = ({ title, file, fn, criteria }: WriterBrief) =>
  [
    `You write the tests for an issue before anyone implements it. Someone else writes the code afterwards and must make your tests pass without changing them.`,
    `# ${title}`,
    `\`${fn}\` in ${file} is only a starting point and does not work yet.`,
    `Acceptance criteria:\n${criteria.map((c) => `- [${c.id}] ${c.text}`).join("\n")}`,
    [
      `Write ${TEST_FILE} with node:test and node:assert/strict:`,
      `- Exactly one test per criterion. Start its name with the criterion's id and a colon, like "${criteria[0]?.id ?? "c1"}: ...".`,
      `- When the criterion gives an example, the test asserts exactly that example: the same input and the same result.`,
      `- A test must pass only if its criterion is met, and it checks that one criterion and nothing else. Add a second assertion only when the first would already pass on code that does nothing.`,
      `- Only top-level test() calls. No describe, no nested tests.`,
      `- Change no other file. You cannot run commands.`,
    ].join("\n"),
    `Reply with one sentence when the file is written.`,
  ].join("\n\n");
