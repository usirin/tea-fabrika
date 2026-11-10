// The lead tooling under `.agents/` is held to `next/`'s rules (0033). What it broke on the day it
// joined is named in `agents-ledger.json`, and a finding the ledger names does not block. The ledger
// only shrinks: `lint.ts` writes back only the entries a finding still matches, and CI fails until
// that pruned file is committed. Nothing here adds an entry; that is the owner's call.
//
// An entry is keyed by file, rule and the finding's line of code with its spaces collapsed, never a
// line number, so code moving up or down keeps its entry and a changed line loses it.

/** One finding, or one ledger entry: the same three keys. */
export interface Finding {
  readonly file: string;
  readonly rule: string;
  readonly code: string;
}

/** Where a ledger entry may point: only the lead tooling, never `next/` or anywhere else. */
export const LEDGER_ROOT = ".agents/";

/** A line of code as the ledger keys it: trimmed, each run of spaces one space. */
export const fingerprint = (line: string): string => line.trim().replace(/\s+/g, " ");

/** The ledger entries outside `.agents/`: each one is refused, not read. */
export const outside = (entries: readonly Finding[]): readonly Finding[] =>
  entries.filter((entry) => !entry.file.startsWith(LEDGER_ROOT));

const key = ({ file, rule, code }: Finding) => JSON.stringify([file, rule, code]);

/**
 * Splits the findings into those the ledger names and those that block, and keeps the entries a
 * finding still matched, in the ledger's order. Each entry covers one finding, so two equal lines
 * need two entries.
 */
export const settle = (
  entries: readonly Finding[],
  findings: readonly Finding[],
): {
  readonly waived: readonly Finding[];
  readonly blocks: readonly Finding[];
  readonly kept: readonly Finding[];
} => {
  const open = new Map<string, number[]>();

  for (const [i, entry] of entries.entries()) {
    if (entry.file.startsWith(LEDGER_ROOT)) {
      open.set(key(entry), [...(open.get(key(entry)) ?? []), i]);
    }
  }

  const used = new Set<number>();
  const waived: Finding[] = [];
  const blocks: Finding[] = [];

  for (const finding of findings) {
    const i = open.get(key(finding))?.shift();

    if (i === undefined) {
      blocks.push(finding);
    } else {
      used.add(i);
      waived.push(finding);
    }
  }

  return { waived, blocks, kept: entries.filter((_, i) => used.has(i)) };
};
