// The top-level statements of a TypeScript file, each with the name it
// declares, if any. A piece `file.ts#name` is the text of every top-level
// statement that declares `name`, so a line range that shifts never matters:
// only what is inside the named block does.
//
// It is a small scanner, not a parser. It tracks strings, template strings,
// comments and bracket depth, and a statement starts on a line that begins,
// at column 0, outside all of them. Code here is formatted by oxfmt, so a
// top-level statement always starts at column 0.
//
// Where it can be wrong: a regular expression literal with an unmatched
// bracket in it (`/[(]/`) throws the depth off. Too deep, a block runs on to
// the end of the file and covers more: safe. Too shallow, a block ends early
// and a change below that point is not seen.

export interface Block {
	/** The name it declares; `null` for an import, a comment, a bare call. */
	readonly name: string | null;
	/** 1-based, inclusive. */
	readonly from: number;
	readonly to: number;
	readonly text: string;
}

const DECLARES =
	/^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;

/** For each line, whether it begins at the top level: outside every string, comment and bracket. */
function topLevelLines(source: string): readonly boolean[] {
	const top: boolean[] = [true];
	// A stack of what we are inside: code with its depth, or a template string.
	const stack: ({kind: "code"; depth: number} | {kind: "template"})[] = [{kind: "code", depth: 0}];
	let mode: "code" | "line" | "block" | "'" | '"' = "code";
	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		const next = source[i + 1];
		const frame = stack[stack.length - 1] ?? {kind: "code" as const, depth: 0};
		if (ch === "\n") {
			if (mode === "line") mode = "code";
			top.push(stack.length === 1 && frame.kind === "code" && frame.depth === 0 && mode === "code");
			continue;
		}
		if (mode === "line") continue;
		if (mode === "block") {
			if (ch === "*" && next === "/") {
				mode = "code";
				i++;
			}
			continue;
		}
		if (mode === "'" || mode === '"') {
			if (ch === "\\") i++;
			else if (ch === mode) mode = "code";
			continue;
		}
		if (frame.kind === "template") {
			if (ch === "\\") i++;
			else if (ch === "`") stack.pop();
			else if (ch === "$" && next === "{") {
				stack.push({kind: "code", depth: 0});
				i++;
			}
			continue;
		}
		if (ch === "/" && next === "/") mode = "line";
		else if (ch === "/" && next === "*") {
			mode = "block";
			i++;
		} else if (ch === "'" || ch === '"') mode = ch;
		else if (ch === "`") stack.push({kind: "template"});
		else if (ch === "{" || ch === "(" || ch === "[") frame.depth++;
		else if (ch === "}" || ch === ")" || ch === "]") {
			if (frame.depth === 0 && stack.length > 1) stack.pop();
			else frame.depth = Math.max(0, frame.depth - 1);
		}
	}
	return top;
}

/** Every top-level statement of a file, in order. */
export function blocksOf(source: string): readonly Block[] {
	const lines = source.split("\n");
	const top = topLevelLines(source);
	const starts = lines.flatMap((line, at) =>
		top[at] === true && line.length > 0 && !/^\s/.test(line) ? [at] : [],
	);
	return starts.map((from, k) => {
		let to = (starts[k + 1] ?? lines.length) - 1;
		while (to > from && (lines[to] ?? "").trim() === "") to--;
		const text = lines.slice(from, to + 1).join("\n");
		return {name: DECLARES.exec(lines[from] ?? "")?.[1] ?? null, from: from + 1, to: to + 1, text};
	});
}

/** A piece split into its file and its block name. `null`: the whole file. */
export function splitPiece(piece: string): {readonly file: string; readonly name: string | null} {
	const at = piece.indexOf("#");
	return at < 0 ? {file: piece, name: null} : {file: piece.slice(0, at), name: piece.slice(at + 1)};
}

/** The text a piece names in a file's source. `null`: no top-level block declares that name. */
export function textOf(source: string, name: string | null): string | null {
	if (name === null) return source;
	const found = blocksOf(source).filter((b) => b.name === name);
	return found.length === 0 ? null : found.map((b) => b.text).join("\n");
}
