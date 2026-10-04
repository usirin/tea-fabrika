// The toys the experiments share: for each one, its criteria, the test that
// settles each, one correct implementation and several broken on purpose.

export interface Toy {
  readonly fixture: string;
  readonly file: string;
  readonly title: string;
  /** Criterion text -> the name of the test that settles it. */
  readonly criteria: Readonly<Record<string, string>>;
  readonly variants: Readonly<Record<string, string>>;
  /** Criterion text -> the variant that breaks that criterion and nothing else. */
  readonly breakers: Readonly<Record<string, string>>;
}

export const variant = (toy: Toy, name: string): string => {
  const source = toy.variants[name];
  if (source === undefined) throw new Error(`${toy.fixture} has no variant ${name}`);
  return source;
};

/** The code that breaks `criterion` and nothing else. */
export const breakerOf = (toy: Toy, criterion: string): string => {
  const name = toy.breakers[criterion];
  if (name === undefined) throw new Error(`${toy.fixture} has no breaker for: ${criterion}`);
  return variant(toy, name);
};

export const slugify: Toy = {
  fixture: "slugify",
  file: "slugify.js",
  title: "slugify turns a title into a URL slug",
  criteria: {
    "Upper-case letters in the title come out lower case in the slug.": "the slug is lower case",
    "A run of one or more spaces between words becomes a single dash.": "spaces become single dashes",
    "Punctuation and accented letters are removed from the slug.":
      "characters outside a-z and 0-9 are dropped",
  },
  breakers: {
    "Upper-case letters in the title come out lower case in the slug.": "no_lower_case",
    "A run of one or more spaces between words becomes a single dash.": "one_dash_per_space",
    "Punctuation and accented letters are removed from the slug.": "keeps_punctuation",
  },
  variants: {
    correct: `export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/ +/g, "-");
}
`,
    no_lower_case: `export function slugify(title) {
  return title.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/ +/g, "-");
}
`,
    one_dash_per_space: `export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/ /g, "-");
}
`,
    keeps_punctuation: `export function slugify(title) {
  return title.toLowerCase().trim().replace(/ +/g, "-");
}
`,
  },
};

const durationHead = (number: string) => `const NUMBER = "${number}";
const PARTS = new RegExp(
  \`^(?:\${NUMBER}\\\\s*h)?\\\\s*(?:\${NUMBER}\\\\s*m)?\\\\s*(?:\${NUMBER}\\\\s*s)?$\`
);
const BARE_NUMBER = new RegExp(\`^\${NUMBER}$\`);
`;
const DECIMAL = "(\\\\d+(?:\\\\.\\\\d+)?)";
const durationBody = (o: { lower: boolean; bare: boolean; miss: string }) => `
export function parseDuration(text) {
  const input = text.trim()${o.lower ? ".toLowerCase()" : ""};
  if (input === "") return null;
${o.bare ? "  if (BARE_NUMBER.test(input)) return Number(input);\n" : ""}  const match = PARTS.exec(input);
  if (!match) return ${o.miss};
  const [, hours = 0, minutes = 0, seconds = 0] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
`;
const ok = { lower: true, bare: true, miss: "null" };

export const duration: Toy = {
  fixture: "duration-open",
  file: "duration.js",
  title: 'parseDuration turns text like "1h30m" into seconds',
  criteria: {
    'parseDuration("1h30m") returns 5400.': "combined units",
    'A bare number with no unit, such as "90", is returned as that many seconds.':
      "a bare number is seconds",
    'A decimal part is accepted, so "1.5h" returns 5400.': "a part can be a decimal",
    'Upper-case unit letters are accepted, so "1H30M" returns 5400.': "units can be upper case",
    'Units written smaller before larger, such as "30m1h", return null.':
      "units must go from largest to smallest, each at most once",
    'Text with an unknown unit, such as "1x", returns null.': "text that is not a duration is null",
  },
  breakers: {
    'parseDuration("1h30m") returns 5400.': "single_unit_only",
    'A bare number with no unit, such as "90", is returned as that many seconds.': "no_bare_number",
    'A decimal part is accepted, so "1.5h" returns 5400.': "no_decimals",
    'Upper-case unit letters are accepted, so "1H30M" returns 5400.': "no_upper_case",
    'Units written smaller before larger, such as "30m1h", return null.': "any_order",
    'Text with an unknown unit, such as "1x", returns null.': "zero_for_unknown",
  },
  variants: {
    correct: durationHead(DECIMAL) + durationBody(ok),
    no_bare_number: durationHead(DECIMAL) + durationBody({ ...ok, bare: false }),
    no_decimals: durationHead("(\\\\d+)") + durationBody(ok),
    no_upper_case: durationHead(DECIMAL) + durationBody({ ...ok, lower: false }),
    zero_for_unknown: durationHead(DECIMAL) + durationBody({ ...ok, miss: "0" }),
    // Handles one unit at a time and nothing combined.
    single_unit_only: `export function parseDuration(text) {
  const input = text.trim().toLowerCase();
  if (input === "") return null;
  if (/^\\d+(?:\\.\\d+)?$/.test(input)) return Number(input);
  const match = /^(\\d+(?:\\.\\d+)?)\\s*([hms])$/.exec(input);
  if (!match) return null;
  return Number(match[1]) * { h: 3600, m: 60, s: 1 }[match[2]];
}
`,
    any_order: `export function parseDuration(text) {
  const input = text.trim().toLowerCase();
  if (input === "") return null;
  if (/^\\d+(?:\\.\\d+)?$/.test(input)) return Number(input);
  const unit = { h: 3600, m: 60, s: 1 };
  let total = 0;
  let rest = input;
  while (rest !== "") {
    const match = /^(\\d+(?:\\.\\d+)?)\\s*([hms])\\s*/.exec(rest);
    if (!match) return null;
    total += Number(match[1]) * unit[match[2]];
    rest = rest.slice(match[0].length);
  }
  return total;
}
`,
  },
};

/** The same toy with some criteria reworded: every map of it is rekeyed to the new text. */
export function reword(toy: Toy, wording: Readonly<Record<string, string>>): Toy {
  const rekey = (map: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(map).map(([text, value]) => [wording[text] ?? text, value]));
  return { ...toy, criteria: rekey(toy.criteria), breakers: rekey(toy.breakers) };
}

/** slugify's criteria are abstract claims. This gives each one a worked example. */
export const SLUGIFY_EXAMPLES: Readonly<Record<string, string>> = {
  "Upper-case letters in the title come out lower case in the slug.":
    'Upper-case letters in the title come out lower case in the slug, so "Hello" becomes "hello".',
  "A run of one or more spaces between words becomes a single dash.":
    'A run of one or more spaces between words becomes a single dash, so "hello   big world" becomes "hello-big-world".',
  "Punctuation and accented letters are removed from the slug.":
    'Punctuation and accented letters are removed from the slug, so "héllo, wörld!" becomes "hllo-wrld".',
};

export const slugifyWithExamples = reword(slugify, SLUGIFY_EXAMPLES);

const slugifyKeeping = (dropped: string) => `export function slugify(title) {
  return title.toLowerCase().replace(${dropped}, "").trim().replace(/ +/g, "-");
}
`;

/**
 * slugify with the judge's rules applied to its criteria: one claim each, each
 * with a worked example. "Punctuation and accented letters" becomes two.
 */
export const slugifyOneClaim: Toy = {
  ...slugify,
  criteria: {
    'Upper-case letters come out lower case, so "Hello" becomes "hello".': "the slug is lower case",
    'Several spaces in a row between two words become one dash, so "a   b" becomes "a-b".':
      "spaces become single dashes",
    'Punctuation is removed, so "hello, world!" becomes "hello-world".':
      "characters outside a-z and 0-9 are dropped",
    'Accented letters are removed, so "héllo" becomes "hllo".':
      "characters outside a-z and 0-9 are dropped",
  },
  breakers: {
    'Upper-case letters come out lower case, so "Hello" becomes "hello".': "no_lower_case",
    'Several spaces in a row between two words become one dash, so "a   b" becomes "a-b".':
      "one_dash_per_space",
    'Punctuation is removed, so "hello, world!" becomes "hello-world".': "leaves_punctuation",
    'Accented letters are removed, so "héllo" becomes "hllo".': "leaves_accents",
  },
  variants: {
    ...slugify.variants,
    // Drops accented letters and keeps punctuation.
    leaves_punctuation: slugifyKeeping("/[^\\x20-\\x7e]/g"),
    // Drops punctuation and keeps accented letters.
    leaves_accents: slugifyKeeping("/[^a-z0-9 \\u00c0-\\u024f]/g"),
  },
};
