import { Schema } from "effect";
import type { Result } from "../../controls.ts";

// A vitest JSON report, read for the tests a writer named. Pure.
//
//   a test that ran and failed                red
//   a test that ran and passed                green
//   a file that did not load: a name it imports does not exist yet
//                                             red: code the test writer's `new` property waits for
//   a file that did not load for any other reason, or a test the report does not hold
//                                             no answer: something is wrong with the test or the run
//
// The second line is what the brief tells the writer too: a test that imports what the build will
// add cannot load before the build, and that is the red the plan asked for.

const Assertion = Schema.Struct({
  /** Each `describe` the test is in, outermost first. The mutation step names a failing test by them. */
  ancestorTitles: Schema.optionalKey(Schema.Array(Schema.String)),
  title: Schema.String,
  fullName: Schema.optionalKey(Schema.String),
  status: Schema.String,
  failureMessages: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
});

export const Report = Schema.Struct({
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.optionalKey(Schema.String),
      message: Schema.optionalKey(Schema.NullOr(Schema.String)),
      assertionResults: Schema.Array(Assertion),
    }),
  ),
});
export type Report = typeof Report.Type;

const WAITS_ON_CODE =
  /Cannot find module|Failed to (resolve|load)|does not provide an export|is not exported|ERR_MODULE_NOT_FOUND/;

interface Named {
  readonly property: string;
  readonly file: string;
  readonly name: string;
}

export const resultsOf = (
  report: Report,
  tests: readonly Named[],
): readonly { readonly property: string; readonly result: Result }[] =>
  tests.flatMap((test): readonly { readonly property: string; readonly result: Result }[] => {
    const file = report.testResults.find((r) => r.name.endsWith(test.file));

    if (file === undefined) {
      return [];
    }

    const found = file.assertionResults.find(
      (a) => a.title === test.name || a.fullName === test.name || a.fullName?.endsWith(` ${test.name}`),
    );

    if (found !== undefined) {
      if (found.status === "passed") {
        return [{ property: test.property, result: "green" }];
      }

      if (found.status === "failed") {
        return [{ property: test.property, result: "red" }];
      }

      return [];
    }

    return file.assertionResults.length === 0 && WAITS_ON_CODE.test(file.message ?? "")
      ? [{ property: test.property, result: "red" }]
      : [];
  });

/**
 * The longest name or error line kept, in characters. Ours, with no source: long enough for a
 * file, a few describes and a title, short enough that one name cannot fill a comment.
 */
export const NAME_MOST = 200;

const CUT = "...";

/** Text as one line of at most `NAME_MOST`: any run of spaces, tabs or newlines is one space. Pure. */
const oneLine = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= NAME_MOST ? line : `${line.slice(0, NAME_MOST - CUT.length)}${CUT}`;
};

/** The first line of an error that says something: vitest's own leads with the error's name. */
const firstLine = (text: string | null | undefined): string =>
  oneLine(
    (text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "",
  );

/**
 * Each test that failed in a report, by name: its file from `root`, each `describe`, then its own
 * title, joined with ` > `. A file that did not load fails as a whole, by its path. `error`: the
 * first line of why. A name is the repository's own text, bound for a public ticket and an agent's
 * brief, so each is one line of at most `NAME_MOST`, here, before anything reads it. Pure.
 */
export const failuresOf = (
  report: Report,
  root: string,
): readonly { readonly name: string; readonly error: string }[] =>
  report.testResults.flatMap((file) => {
    const path = file.name.startsWith(`${root}/`) ? file.name.slice(root.length + 1) : file.name;
    const failed = file.assertionResults.filter((a) => a.status === "failed");

    if (failed.length > 0) {
      return failed.map((a) => ({
        name: oneLine([path, ...(a.ancestorTitles ?? []), a.title].join(" > ")),
        error: firstLine(a.failureMessages?.[0]),
      }));
    }

    return file.status === "failed" ? [{ name: oneLine(path), error: firstLine(file.message) }] : [];
  });
