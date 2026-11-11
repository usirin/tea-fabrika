// Counted work, for laws that say how a walk grows (ticket 649). Today's version. A clock read on a
// shared runner gave a correct `childrenOf` a false red, so a speed law counts the steps the code
// takes through the built-ins instead: the same number on every machine (0052, 0065). Its gaps are
// written down and accepted (0065): a hand `while` loop, an index loop that does arithmetic on `i`,
// `Object.values`, `String` methods and typed arrays are not counted. `typescript/prefer-for-of`
// catches the plain index loop. The shape is PR 803's `scripts/effect-arbitrary.test.ts`: wrap,
// count, restore.

/** The built-ins whose cost grows with their receiver's length. */
const LINEAR = [
  "concat",
  "slice",
  "splice",
  "includes",
  "indexOf",
  "lastIndexOf",
  "filter",
  "map",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "forEach",
  "reduce",
  "reduceRight",
  "join",
  "sort",
  "toSorted",
  "toSpliced",
  "toReversed",
  "reverse",
  "with",
  "flat",
  "flatMap",
  "fill",
  "copyWithin",
  "shift",
  "unshift",
] as const;

/** The iterators every spread, `for...of` and destructuring of an Array, Map or Set steps. */
const ITERATORS: readonly object[] = [
  Object.getPrototypeOf([][Symbol.iterator]()),
  Object.getPrototypeOf(new Map()[Symbol.iterator]()),
  Object.getPrototypeOf(new Set()[Symbol.iterator]()),
];

/** The work `f` passed its cap: it carries both, so a red law prints them. */
export class OverCap extends Error {
  readonly work: number;
  readonly cap: number;

  constructor(work: number, cap: number) {
    super(`counted work passed its cap: ${work} > ${cap}`);
    this.work = work;
    this.cap = cap;
  }
}

/** The length of an array-like, or 0. */
const lengthOf = (x: unknown): number => {
  const n: unknown = typeof x === "object" && x !== null ? Reflect.get(x, "length") : 0;
  return typeof n === "number" ? n : 0;
};

/**
 * The work `f` does through the built-ins: 1 per step of an Array, Map or Set iterator (so every
 * spread, `for...of` and destructuring), the receiver's length per call of a LINEAR method, the
 * result's length per `Array.from`. Throws OverCap once work passes `cap`. Puts every wrapped
 * method back before it returns or throws.
 */
export const counted = <A>(f: () => A, cap: number): { readonly value: A; readonly work: number } => {
  const saved: { readonly target: object; readonly key: string; readonly method: unknown }[] = [];
  let work = 0;
  let live = false;
  let over = false;

  const spend = (units: number) => {
    if (!live) {
      return;
    }

    work += units;

    if (work > cap) {
      live = false;
      over = true;
      throw new OverCap(work, cap);
    }
  };

  // The wrapper takes no iterator step: rest parameters and Reflect.apply read arguments by index.
  const wrap = (target: object, key: string, cost: (before: number, result: unknown) => number) => {
    const original: unknown = Reflect.get(target, key);

    if (typeof original !== "function") {
      return;
    }

    saved.push({ target, key, method: original });
    Reflect.set(target, key, function (this: unknown, ...args: unknown[]): unknown {
      // The receiver's length before the call: `splice` and `shift` change it.
      const before = lengthOf(this);
      const result: unknown = Reflect.apply(original, this, args);
      spend(cost(before, result));
      return result;
    });
  };

  for (const iterator of ITERATORS) {
    wrap(iterator, "next", () => 1);
  }

  for (const key of LINEAR) {
    wrap(Array.prototype, key, (before) => before);
  }

  wrap(Array, "from", (_, result) => lengthOf(result));

  try {
    live = true;
    const value = f();
    live = false;

    if (over) {
      throw new OverCap(work, cap);
    }

    return { value, work };
  } finally {
    live = false;

    for (const { target, key, method } of saved) {
      Reflect.set(target, key, method);
    }
  }
};
