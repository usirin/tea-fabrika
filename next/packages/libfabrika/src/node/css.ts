// One stylesheet with its local `@import`s inlined, read the way CSS Syntax Level 3 tokenizes
// (https://www.w3.org/TR/css-syntax-3/#tokenization): comments, strings, escapes and url tokens.
// A window's stylesheet is served from the brain's table, which holds scripts and stylesheets only,
// so any other local file a stylesheet names stops the build instead of answering 404 later.
// It runs inside a Rolldown hook, outside Effect: it reads files directly, and a throw fails the bundle.
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";

const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c);
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isNameChar = (c: string) => /^[\w-]$/.test(c) || c.charCodeAt(0) >= 0x80;
/** A reference to a scheme (`https:`, `data:`), a host (`//`) or a fragment is not a local file. */
const remote = (ref: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref);

class Reader {
	at = 0;
	constructor(readonly text: string) {}
	peek(offset = 0) {
		return this.text[this.at + offset] ?? "";
	}
	spaces() {
		for (;;) {
			if (isSpace(this.peek())) this.at++;
			else if (this.peek() === "/" && this.peek(1) === "*") this.comment();
			else return;
		}
	}
	comment() {
		const end = this.text.indexOf("*/", this.at + 2);
		this.at = end < 0 ? this.text.length : end + 2;
	}
	// After a backslash: up to six hex digits and one space, or the next code point as itself.
	escape(): string {
		if (isHex(this.peek())) {
			let hex = "";
			while (hex.length < 6 && isHex(this.peek())) hex += this.text[this.at++];
			if (isSpace(this.peek())) this.at += this.peek() === "\r" && this.peek(1) === "\n" ? 2 : 1;
			const code = Number.parseInt(hex, 16);
			return code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff
				? "�"
				: String.fromCodePoint(code);
		}
		const code = this.text.codePointAt(this.at);
		if (code === undefined) return "�";
		const char = String.fromCodePoint(code);
		this.at += char.length;
		return char;
	}
	string(): string {
		const quote = this.text[this.at++];
		let value = "";
		for (;;) {
			const c = this.peek();
			if (c === "") return value;
			this.at++;
			if (c === quote) return value;
			if (c === "\n") throw new Error("stylesheet has a broken string");
			if (c !== "\\") value += c;
			else if (this.peek() === "\n") this.at++;
			else if (this.peek() !== "") value += this.escape();
		}
	}
	// After `url(`: a quoted string inside the function, or an unquoted url token.
	url(): string {
		this.spaces();
		if (this.peek() === '"' || this.peek() === "'") {
			const value = this.string();
			this.spaces();
			if (this.text[this.at++] !== ")") throw new Error("stylesheet has a broken url()");
			return value;
		}
		let value = "";
		for (;;) {
			const c = this.peek();
			if (c === "") throw new Error("stylesheet has a broken url()");
			this.at++;
			if (c === ")") return value;
			if (isSpace(c)) {
				this.spaces();
				if (this.text[this.at++] !== ")") throw new Error("stylesheet has a broken url()");
				return value;
			}
			if (c === '"' || c === "'" || c === "(") throw new Error("stylesheet has a broken url()");
			value += c === "\\" ? this.escape() : c;
		}
	}
	word(word: string) {
		const found = this.text.slice(this.at, this.at + word.length).toLowerCase() === word;
		return found && !isNameChar(this.peek(word.length)) ? (this.at += word.length) > 0 : false;
	}
	// At `@`: whether this is the named at-rule. Either way the reader is past the `@`.
	atRule(name: string) {
		this.at++;
		return this.word(name);
	}
	// The rest of an `@import` prelude, its media list or condition, up to the closing `;`.
	prelude(): string {
		const from = this.at;
		let depth = 0;
		for (;;) {
			const c = this.peek();
			if (c === "" || (c === ";" && depth === 0)) {
				const text = this.text.slice(from, this.at);
				if (c === ";") this.at++;
				return text.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
			}
			if (c === '"' || c === "'") this.string();
			else if (c === "/" && this.peek(1) === "*") this.comment();
			else {
				if (c === "(") depth++;
				if (c === ")") depth--;
				this.at++;
			}
		}
	}
}

const inline = (file: string, seen: ReadonlySet<string>): string => {
	if (seen.has(file)) throw new Error("stylesheet imports itself");
	const within = new Set([...seen, file]);
	const reader = new Reader(readFileSync(file, "utf8"));
	const text = reader.text;
	let out = "",
		copied = 0;
	while (reader.at < text.length) {
		const c = reader.peek(),
			start = reader.at;
		if (c === "/" && reader.peek(1) === "*") reader.comment();
		else if (c === '"' || c === "'") reader.string();
		else if (c === "\\") {
			reader.at++;
			reader.escape();
		} else if (c === "@" && reader.atRule("import")) {
			reader.spaces();
			let ref: string;
			if (reader.peek() === '"' || reader.peek() === "'") ref = reader.string();
			else if (reader.word("url") && reader.peek() === "(") {
				reader.at++;
				ref = reader.url();
			} else throw new Error("stylesheet has a broken @import");
			const condition = reader.prelude();
			if (remote(ref)) continue;
			if (/^(?:layer|supports)\b/i.test(condition))
				throw new Error("unsupported @import condition");
			const body = inline(resolve(dirname(file), ref), within);
			out += text.slice(copied, start) + (condition ? `@media ${condition} {\n${body}\n}` : body);
			copied = reader.at;
		} else if (isNameChar(c) && !isNameChar(text[start - 1] ?? " ") && reader.word("url")) {
			if (reader.peek() !== "(") continue;
			reader.at++;
			if (!remote(reader.url())) throw new Error("stylesheet references a file");
		} else if (isNameChar(c)) while (isNameChar(reader.peek())) reader.at++;
		else reader.at++;
	}
	return out + text.slice(copied);
};

/** The stylesheet at `file` with every local `@import` inlined, in order, under its media list. */
export const inlineStylesheet = (file: string) => inline(file, new Set());
