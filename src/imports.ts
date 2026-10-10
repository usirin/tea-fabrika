import { basename } from "node:path";

// Which files sit one import away from a change, read by name alone: no
// parser, no resolver, no Jev. Experiment 38 (`experiments/name-filter.ts`
// runs these very functions) kept every forgotten file of 28 trials this way,
// at about a twelfth of the files in the touched packages.

/** A file's name up to its first dot: `check-verb.unit.test.ts` is `check-verb`. */
export const stem = (path: string) => basename(path).split(".")[0] as string;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Import-like names in a text: a word after / ' " or `, before . ' " or `. `./leaks.ts` gives `leaks`. */
const SPECIFIER = /(?<=[/'"`])[\w-]+(?=[.'"`])/g;

/**
 * Whether a text imports one of `changed`: it names a changed file's stem the
 * way an import does, right after / ' " or ` and right before . ' " or `.
 * A dotfile has no stem, so it is never matched.
 */
export function importsOneOf(changed: readonly string[]): (text: string) => boolean {
  const stems = [...new Set(changed.map(stem).filter((s) => s !== ""))];
  if (stems.length === 0) return () => false;
  const imports = new RegExp(`(?<=[/'"\`])(?:${stems.map(escape).join("|")})(?=[.'"\`])`);
  return (text) => imports.test(text);
}

/**
 * Whether a file is imported by one of `texts`, the changed files as the
 * change left them: one of them names its stem the way an import does.
 */
export function importedBy(texts: readonly string[]): (path: string) => boolean {
  const used = new Set(texts.flatMap((text) => text.match(SPECIFIER) ?? []));
  return (path) => used.has(stem(path));
}

/** A file and its text. */
export interface Text {
  readonly path: string;
  readonly text: string;
}

/**
 * The candidates one import away from the change, either way: a candidate
 * that imports a changed file, or one a changed file imports. `candidates`
 * are read as the change found them, `changed` as the change left them (a
 * deleted file is ""). Matched by name, so a common stem like `index` or
 * `types` matches every file of that name, and a folder import (`./time`)
 * never reaches `time/index.ts`.
 */
export function oneImportAway<C extends Text>(candidates: readonly C[], changed: readonly Text[]): readonly C[] {
  const imports = importsOneOf(changed.map((c) => c.path));
  const imported = importedBy(changed.map((c) => c.text));
  return candidates.filter((c) => imports(c.text) || imported(c.path));
}
