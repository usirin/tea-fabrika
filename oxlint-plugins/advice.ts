// Where the five old advice rules still advise (0523, 0168). Each is "error" in its base scope, so it
// blocks in every folder at zero. A dirty folder's override, placed last in `.oxlintrc.json`, sets it
// to "warn", and only a fire oxlint grades a warning there is advice. A warn line goes the moment its
// folder reaches zero: `stale` names it, and a whole `pnpm lint` run fails until it is deleted.
import { matchesGlob } from "node:path";

/** The five, as oxlint prints their codes. */
const ADVICE: ReadonlySet<string> = new Set([
  "eslint(no-restricted-properties)",
  "fabrika(law-shape)",
  "fabrika(no-effect-promise)",
  "fabrika(no-raw-try-catch)",
  "fabrika(prefer-schema-arbitrary)",
]);

/**
 * A rule's key in `--print-config`, to the code oxlint prints for it. A builtin's key comes back
 * without its plugin (`no-restricted-properties`); ours keep it (`fabrika/law-shape`).
 */
const CODES: ReadonlyMap<string, string> = new Map([
  ["no-restricted-properties", "eslint(no-restricted-properties)"],
  ["eslint/no-restricted-properties", "eslint(no-restricted-properties)"],
  ["fabrika/law-shape", "fabrika(law-shape)"],
  ["fabrika/no-effect-promise", "fabrika(no-effect-promise)"],
  ["fabrika/no-raw-try-catch", "fabrika(no-raw-try-catch)"],
  ["fabrika/prefer-schema-arbitrary", "fabrika(prefer-schema-arbitrary)"],
]);

/**
 * The frozen version's paths (0525), where the config's one frozen override keeps the two top-level
 * rules at "warn". That override is not a dirty-folder line: no fill brings it to zero, so these
 * globs are never read as warn lines. It and this set go when the freeze lane takes the paths out
 * of lint.
 */
const FROZEN: ReadonlySet<string> = new Set(["apps/**", "programs/**", "packages/**", "bin/**"]);

/** One fire as oxlint reports it, its filename from the top of the repo. */
export interface Fire {
  readonly code?: string;
  readonly severity?: string;
  readonly filename?: string;
}

/** True only for one of the five, graded "warning" by a dirty folder's override. */
export const advises = (fire: Fire): boolean => ADVICE.has(fire.code ?? "") && fire.severity === "warning";

/** One warn line of the config: one of the five, one folder glob. */
export interface WarnLine {
  readonly rule: string;
  readonly glob: string;
}

/** What a whole run says about a warn line: its folder has no fire left, or it names a file. */
type Stale = { readonly _tag: "zero"; readonly line: WarnLine } | { readonly _tag: "file"; readonly line: WarnLine };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A rule's level: the setting itself, or the first item of `[level, ...options]`. */
const level = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting);

/** The warn lines for the five, read from `oxlint --print-config`, oxlint's own reading of the config. */
export const warnLines = (printed: unknown): ReadonlyArray<WarnLine> => {
  const overrides = isRecord(printed) && Array.isArray(printed.overrides) ? printed.overrides : [];
  return overrides.flatMap((override: unknown) => {
    if (!isRecord(override) || !isRecord(override.rules) || !Array.isArray(override.files)) {
      return [];
    }

    const globs = override.files.filter(
      (glob: unknown): glob is string => typeof glob === "string" && !FROZEN.has(glob),
    );
    return Object.entries(override.rules).flatMap(([key, setting]) => {
      const rule = CODES.get(key);
      return rule !== undefined && level(setting) === "warn" ? globs.map((glob) => ({ rule, glob })) : [];
    });
  });
};

/** Each warn line no advice fire of its rule matches, and each one whose last part names a file. */
export const stale = (lines: ReadonlyArray<WarnLine>, advice: ReadonlyArray<Fire>): ReadonlyArray<Stale> =>
  lines.flatMap((line): ReadonlyArray<Stale> => {
    if (!(line.glob.split("/").at(-1) ?? "").includes("*")) {
      return [{ _tag: "file", line }];
    }

    const held = advice.some(
      (fire) => fire.code === line.rule && fire.filename !== undefined && matchesGlob(fire.filename, line.glob),
    );
    return held ? [] : [{ _tag: "zero", line }];
  });
