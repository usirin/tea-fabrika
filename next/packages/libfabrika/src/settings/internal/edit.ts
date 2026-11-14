import { Equal, Predicate, Result } from "effect";

/** @internal */
export type Path = ReadonlyArray<string | number>;

/** @internal */
export interface Range {
  readonly start: number;
  readonly end: number;
}

/** @internal */
export interface Assignment extends Range {
  readonly path: Path;
  readonly line: number;
  readonly value: Range;
  readonly inline?: Range;
}

/** @internal */
export interface Inline extends Range {
  readonly path: Path;
  readonly members: ReadonlyArray<Assignment>;
  readonly commas: ReadonlyArray<Range>;
}

/** @internal */
export interface Section {
  readonly path: Path;
  readonly line: number;
  readonly end: number;
}

/** @internal */
export interface Index {
  readonly value: Readonly<Record<string, unknown>>;
  readonly assignments: ReadonlyArray<Assignment>;
  readonly inlines: ReadonlyArray<Inline>;
  readonly sections: readonly [Section, ...Array<Section>];
  readonly comments: ReadonlyArray<Range>;
}

/** @internal */
export interface Refusal {
  readonly line: number;
  readonly cause: Error;
}

interface Splice extends Range {
  readonly text: string;
}

/** @internal */
export const prefix = (parent: Path, path: Path): boolean =>
  parent.length <= path.length && parent.every((key, i) => key === path[i]);

const same = (left: Path, right: Path): boolean => left.length === right.length && prefix(left, right);

/** @internal */
export const read = (value: unknown, path: Path): unknown =>
  path.reduce<unknown>(
    (parent, key) =>
      Predicate.isObjectOrArray(parent) && Object.hasOwn(parent, key) ? Reflect.get(parent, key) : undefined,
    value,
  );

const equal = (left: unknown, right: unknown): boolean => {
  if (Predicate.isDate(left) || Predicate.isDate(right)) {
    return Equal.equals(left, right);
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, i) => equal(value, right[i]));
  }

  if (Predicate.isObject(left) && Predicate.isObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
    );
  }

  return Equal.equals(left, right);
};

const ending = (text: string): string => /\r?\n/.exec(text)?.[0] ?? "\n";
const lineStart = (text: string, at: number): number => text.lastIndexOf("\n", at - 1) + 1;

const apply = (text: string, edits: ReadonlyArray<Splice>): string =>
  [...edits]
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce((source, edit) => source.slice(0, edit.start) + edit.text + source.slice(edit.end), text);

// Comments are parser ranges, including the #, never text guessed from a string's contents.
const retained = (text: string, index: Index, range: Range): string =>
  index.comments
    .filter((comment) => comment.start >= range.start && comment.end <= range.end)
    .map((comment) => text.slice(comment.start, comment.end) + ending(text))
    .join("");

/** @internal */
export const check = (index: Index, path: ReadonlyArray<string>): Result.Result<void, Refusal> => {
  let line = 1;

  for (let i = 0; i <= path.length; i++) {
    const at = path.slice(0, i);
    const entry =
      index.assignments.find((assignment) => same(assignment.path, at)) ??
      index.sections.find((section) => same(section.path, at)) ??
      index.sections.find((section) => i > 0 && prefix(at, section.path));

    if (entry) {
      line = entry.line;
    }

    const value = read(index.value, at);

    if (
      path.length === 0 ||
      (i < path.length && value !== undefined && (!Predicate.isObject(value) || Predicate.isDate(value))) ||
      (i === path.length && value !== undefined && !index.assignments.some((assignment) => same(assignment.path, path)))
    ) {
      return Result.fail({ line, cause: new Error("The path does not name an editable setting.") });
    }
  }

  return Result.succeed(undefined);
};

const commentEdits = (text: string, index: Index, assignment: Assignment, removed: Range): Array<Splice> => {
  const comments = retained(text, index, removed);

  if (!comments) {
    return [];
  }

  // An inline member can follow a sibling's comments. Keep retained comments after that sibling.
  const at = assignment.inline ? assignment.start : lineStart(text, assignment.start);
  const before = at > lineStart(text, at) ? ending(text) : "";
  return [{ start: at, end: at, text: before + comments }];
};

/** @internal */
export const remove = (text: string, index: Index, path: ReadonlyArray<string>): Result.Result<string, Refusal> => {
  const checked = check(index, path);

  if (Result.isFailure(checked)) {
    return Result.fail<Refusal>(checked.failure);
  }

  const assignment = index.assignments.find((candidate) => same(candidate.path, path));

  if (!assignment) {
    return Result.succeed(text);
  }

  const edits: Array<Splice> = [{ ...assignment, text: "" }, ...commentEdits(text, index, assignment, assignment)];

  if (assignment.inline) {
    const start = assignment.inline.start;
    const parent = index.inlines.find((inline) => inline.start === start);
    const comma =
      parent?.commas.find((token) => token.start >= assignment.end) ??
      parent?.commas.findLast((token) => token.end <= assignment.start);

    if (comma) {
      edits.push({ ...comma, text: "" });
    }
  }

  const candidate = apply(text, edits);
  // Removing the last assignment must not turn its preceding separator into a final newline.
  return Result.succeed(!text.endsWith("\n") && candidate.endsWith("\n") ? `${candidate} ` : candidate);
};

const insertLine = (text: string, at: number, content: string): string => {
  const eol = ending(text);
  const before = at > 0 && text[at - 1] !== "\n" ? eol : "";
  const after = at < text.length || text.endsWith("\n") ? eol : "";
  return apply(text, [{ start: at, end: at, text: before + content + after }]);
};

/** @internal */
export const set = (
  text: string,
  index: Index,
  path: ReadonlyArray<string>,
  value: unknown,
  rendered: string,
  keys: ReadonlyArray<string>,
): Result.Result<string, Refusal> => {
  const checked = check(index, path);

  if (Result.isFailure(checked)) {
    return Result.fail<Refusal>(checked.failure);
  }

  const assignment = index.assignments.find((candidate) => same(candidate.path, path));

  if (assignment) {
    if (equal(read(index.value, path), value)) {
      return Result.succeed(text);
    }

    return Result.succeed(
      apply(text, [
        { ...assignment.value, text: rendered },
        ...commentEdits(text, index, assignment, assignment.value),
      ]),
    );
  }

  const parent = [...index.inlines]
    .filter((inline) => prefix(inline.path, path))
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (parent) {
    const at = parent.end - 1;
    const last = parent.members.at(-1);
    const separator = last && !parent.commas.some((comma) => comma.start >= last.end) ? ", " : "";
    return Result.succeed(
      apply(text, [
        {
          start: at,
          end: at,
          text: `${separator}${keys.slice(parent.path.length).join(".")} = ${rendered}`,
        },
      ]),
    );
  }

  const parentPath = path.slice(0, -1);

  if (parentPath.length > 0 && read(index.value, parentPath) === undefined) {
    return Result.succeed(
      insertLine(text, text.length, `[${keys.slice(0, -1).join(".")}]${ending(text)}${keys.at(-1)} = ${rendered}`),
    );
  }

  const section =
    [...index.sections]
      .filter((candidate) => prefix(candidate.path, parentPath))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? index.sections[0];
  return Result.succeed(insertLine(text, section.end, `${keys.slice(section.path.length).join(".")} = ${rendered}`));
};
