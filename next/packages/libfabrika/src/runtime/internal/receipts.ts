// T936 slice 2, next/: the pure part of a recovery save. Given the text each receipt row holds, it
// says which receipts a save must write and how many bytes that adds, with no read per receipt.
import { Schema } from "effect";
import { Receipt } from "./recovery.ts";

const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(Receipt));

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

/** @internal What one save writes: each receipt whose text differs from its row, and the bytes that adds. */
export type Changes = {
  readonly changed: ReadonlyArray<{ readonly letter: string; readonly text: string }>;
  readonly growth: number;
};

/**
 * @internal Compares each receipt's text with the text its row holds in `rows`, keyed by letter. A
 * receipt equal to its row is skipped. A changed one adds the difference in bytes, and a new one
 * also adds its key, `name` and letter, as the row's own bytes.
 */
export const changes = (name: string, rows: ReadonlyMap<string, string>, receipts: Iterable<Receipt>): Changes => {
  const changed: Array<{ readonly letter: string; readonly text: string }> = [];
  let growth = 0;

  for (const receipt of receipts) {
    const text = encodeReceipt(receipt);
    const prior = rows.get(receipt.letter);

    if (prior === text) {
      continue;
    }

    growth += prior === undefined ? bytes(text) + bytes(name) + bytes(receipt.letter) : bytes(text) - bytes(prior);
    changed.push({ letter: receipt.letter, text });
  }

  return { changed, growth };
};
