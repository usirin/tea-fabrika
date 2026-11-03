import {describe, expect, it} from "vitest";
import {didYouMean} from "./did-you-mean.ts";
import {type Command, parse, type Statement} from "./grammar.ts";
import {words} from "./words.ts";

// The words and the grammar of a tsh line: no program list here, only what a
// line says. Each refusal points at a character.

const statements = (line: string): readonly Statement[] => {
	const parsed = parse(line);
	if (parsed.kind !== "parsed") throw new Error(`refused: ${parsed.why}`);
	return parsed.statements;
};
const run = (line: string) => {
	const [first] = statements(line);
	if (first?.kind !== "run") throw new Error("not a run");
	return first;
};
const command = (line: string): Command => run(line).pipeline.commands[0];

describe("words", () => {
	it("cuts a line into words and operators, each with where it stands", () => {
		const {tokens} = words(`ship --mode read pr="https://x/pull/1" | review &`);
		expect(tokens.map((t) => (t.kind === "word" ? t.text : t.op))).toEqual([
			"ship",
			"--mode",
			"read",
			"pr=https://x/pull/1",
			"|",
			"review",
			"&",
		]);
		expect(tokens[0]).toMatchObject({start: 0, end: 4});
	});

	it("keeps quoted text whole, and reads escapes", () => {
		const texts = words(`say --text 'a | b' "c \\" d" e\\ f`).tokens.flatMap((t) =>
			t.kind === "word" ? [t.text] : [],
		);
		expect(texts).toEqual(["say", "--text", "a | b", 'c " d', "e f"]);
	});

	it("reads a new line as ;, # as a comment, and $( as one operator even glued to a word", () => {
		const ops = words("a\nb # c | d\npr=$(seq)").tokens.map((t) =>
			t.kind === "word" ? t.text : t.op,
		);
		expect(ops).toEqual(["a", ";", "b", ";", "pr=", "$(", "seq", ")"]);
	});

	it("says when a quote is open, and when the cursor is on a new word", () => {
		expect(words(`say --text "hi`).open).toBe(true);
		expect(words("seq ").trailing).toBe(true);
		expect(words("seq").trailing).toBe(false);
		expect(words("seq |").trailing).toBe(true);
		expect(words("").trailing).toBe(true);
	});
});

describe("the grammar", () => {
	it("reads flags, told inputs, >output, <input and --describe", () => {
		const c = command("ship --mode read pr=https://x/pull/1 >found --to=3");
		expect(c.program.name).toBe("ship");
		expect(c.flags.map((f) => [f.name, f.value.kind === "text" ? f.value.text : "sub"])).toEqual([
			["mode", "read"],
			["to", "3"],
		]);
		expect(c.told.map((t) => t.name)).toEqual(["pr"]);
		expect(c.out?.name).toBe("found");
		expect(command("double <n").into?.name).toBe("n");
	});

	it("reads --help and -h anywhere in a command, and leaves the rest of it unread", () => {
		expect(command("ship --help").help?.name).toBeNull();
		expect(command("ship -h >found").help?.name?.name).toBe(">found");
		// GNU's rule: once --help is seen, the other words are not read, so a half-typed line answers.
		const half = command("ship --mode --help");
		expect(half.help?.name).toBeNull();
		expect(half.flags).toEqual([]);
		expect(command("ship bogus words --help mode").help?.name?.name).toBe("mode");
		// The command ends at the pipe: the next one is read as ever.
		const st = run("ship --help | double");
		expect(st.pipeline.commands.map((c) => c.help === null)).toEqual([false, true]);
		// A --help inside a $( ) is that inner command's, not the outer one's.
		const outer = command("double n=$(seq --help)");
		expect(outer.help).toBeNull();
		const inner = outer.told[0]?.value;
		expect(inner?.kind === "sub" && inner.pipeline.commands[0].help).not.toBeNull();
		expect(command("say --text=--help").help).toBeNull();
	});

	it("reads pipes, jobs and $( ) values", () => {
		const st = run("seq --to 3 | double &");
		expect(st.pipeline.commands.map((c) => c.program.name)).toEqual(["seq", "double"]);
		expect(st.background).toBe(true);
		const sub = command("double n=$(seq --to $(say --text 2))").told[0]?.value;
		expect(sub?.kind).toBe("sub");
		const inner = command("double --x $(seq --to 2 | double)").flags[0]?.value;
		expect(inner?.kind === "sub" && inner.pipeline.commands.length).toBe(2);
	});

	it("parts statements on ; and &, and reads built-ins as plain words", () => {
		const all = statements("tally & tell %1 add 2 3; jobs");
		expect(
			all.map((s) => (s.kind === "run" ? s.pipeline.commands[0].program.name : s.name)),
		).toEqual(["tally", "tell", "jobs"]);
		const tell = all[1];
		expect(tell?.kind === "builtin" && tell.args.map((a) => a.name)).toEqual([
			"%1",
			"add",
			"2",
			"3",
		]);
		expect(statements("  # nothing here\n;;")).toEqual([]);
	});

	it("chains statements on && and ||, each knowing its connector", () => {
		const all = statements("false && say --text no || say --text yes; jobs");
		expect(all.map((s) => s.after)).toEqual([null, "&&", "||", null]);
		// `||` is not two pipes, and `&&` not two jobs.
		expect(words("a||b&&c").tokens.flatMap((t) => (t.kind === "op" ? [t.op] : []))).toEqual([
			"||",
			"&&",
		]);
	});

	it.each([
		["seq --to", 8, "--to needs a value"],
		["seq &&", 4, "&& needs a command after it"],
		["|| seq", 0, "|| needs a command before it"],
		["seq && ; say", 4, "&& needs a command after it"],
		["tally & || seq", 8, "|| needs a command before it"],
		["seq && tally &", 13, "a job (&) cannot be part of an && or || chain"],
		["seq | ", 6, "expected a program name"],
		["seq $(say)", 4, "a $( ) gives a value"],
		["double n=$(seq", 9, "no ) closes this $("],
		["seq )", 4, "a ) with no $( before it"],
		["& seq", 0, "& needs a command before it"],
		["seq stray", 4, "expected --flag value, input=value"],
		["jobs | seq", 5, "jobs is built in"],
		["--to 3", 0, "expected a program name, not --to"],
		[`say --text "hi`, 14, "a quote is not closed"],
		["double n=$()", 11, "$( ) is empty"],
	])("refuses %j at %i: %s", (line, at, why) => {
		const parsed = parse(line);
		expect(parsed.kind).toBe("refused");
		if (parsed.kind !== "refused") return;
		expect(parsed.at).toBe(at);
		expect(parsed.why).toContain(why);
	});

	it("a flag with no value that is a slip for --help says so", () => {
		expect(parse("map --hlep")).toMatchObject({why: "--hlep needs a value", didYouMean: "--help"});
		expect(parse("seq --to")).not.toHaveProperty("didYouMean");
	});
});

describe("did you mean", () => {
	it("finds the closest known name within a small number of edits", () => {
		expect(didYouMean("shp", ["ship", "seq", "say"])).toBe("ship");
		expect(didYouMean("mdoe", ["mode"])).toBe("mode");
		expect(didYouMean("revew-scripted", ["review-scripted", "ship"])).toBe("review-scripted");
		// Two letters swapped is one slip, even in a short name.
		expect(didYouMean("sqe", ["say", "seq"])).toBe("seq");
	});

	it("does not guess far, or at a name that is right", () => {
		expect(didYouMean("zzz", ["ship"])).toBeUndefined();
		expect(didYouMean("ship", ["ship"])).toBeUndefined();
		expect(didYouMean("ab", ["xy"])).toBeUndefined();
	});
});
