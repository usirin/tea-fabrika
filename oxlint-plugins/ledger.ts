// A rule that joins with findings already in the tree blocks every new one, and the findings it met
// on its first day are named in a ledger, which only shrinks. `lint.ts` waives a finding a ledger
// names, writes back only the entries a finding still matched, and CI fails until that pruned file is
// committed. Nothing here adds an entry, and no pull request may: CI's ratchet
// (`next/apps/fabrika/src/exam/ratchet.ts`) refuses an added row (0524).
//
// Two ledgers, each for one folder. `agents-ledger.json` holds what `.agents/` broke the day it was
// held to next/'s rules (0033). `next-ledger.json` holds what `next/` broke the day a rule joined it:
// question-word names (0081), a module two layers down (0043) and a clock or an after-hook (0061).
//
// An entry is keyed by file, rule and the finding's line of code with its spaces collapsed, never a
// line number, so code moving up or down keeps its entry and a changed line loses it.

/** One finding, or one ledger entry: the same three keys. */
export interface Finding {
  readonly file: string;
  readonly rule: string;
  readonly code: string;
}

/** A ledger file, from the top of the repo, and the one folder its entries may point into. */
interface Ledger {
  readonly file: string;
  readonly root: string;
}

export const LEDGERS: readonly Ledger[] = [
  { file: "agents-ledger.json", root: ".agents/" },
  { file: "next-ledger.json", root: "next/" },
];

/** A line of code as a ledger keys it: trimmed, each run of spaces one space. */
export const fingerprint = (line: string): string => line.trim().replace(/\s+/g, " ");

/** The entries outside the ledger's folder: each one is refused, not read. */
export const outside = (entries: readonly Finding[], root: string): readonly Finding[] =>
  entries.filter((entry) => !entry.file.startsWith(root));

const key = ({ file, rule, code }: Finding) => JSON.stringify([file, rule, code]);

/**
 * Splits the findings into those the ledger names and those that block, and keeps the entries a
 * finding still matched, in the ledger's order. Each entry covers one finding, so two equal lines
 * need two entries. Only an entry inside `root` is read.
 */
export const settle = (
  entries: readonly Finding[],
  findings: readonly Finding[],
  root: string,
): {
  readonly waived: readonly Finding[];
  readonly blocks: readonly Finding[];
  readonly kept: readonly Finding[];
} => {
  const open = new Map<string, number[]>();

  for (const [i, entry] of entries.entries()) {
    if (entry.file.startsWith(root)) {
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
