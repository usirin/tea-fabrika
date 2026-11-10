import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {BUILTINS, parse, type Statement} from "./grammar.ts";

// The summon tryout, PR 1 (ticket 237), today's version: a said line in tsh's grammar. A line
// whose first non-space character is `@` is said: its mention is read, and the rest of the line
// is the agent's, as typed. `words` never reads it, so `#`, quotes, `|`, `&` and `;` are text
// (docs/direction/summon-guidelines.md, S2 and S6).
//
//   parse("@scout why does post print #7 twice?")
//   // one statement: {kind: "said", room: null, mentions: [scout at [1,6)],
//   //                 prose: {text: "why does post print #7 twice?", at: [7,38)}, background: false}
//
// Laws S-1 and S-2 of the plan, as the grammar holds them. turn.prose.laws.test.ts holds S-1
// again, through tsh, on the value the `turn` program is told.

/** Seed 119120: the shared one (AGENTS.md). */
const OPTS = {numRuns: 300, seed: 119120};

/** The one statement of a line that parsed. */
const only = (line: string): Statement => {
	const parsed = parse(line);

	if (parsed.kind !== "parsed") {
		throw new Error(`refused at ${parsed.at}: ${parsed.why}`);
	}

	expect(parsed.statements).toHaveLength(1);
	const [first] = parsed.statements;

	if (first === undefined) {
		throw new Error("no statement");
	}

	return first;
};

/** The said statement of a line, or a failure that names what it was read as. */
const said = (line: string) => {
	const st = only(line);

	if (st.kind !== "said") {
		throw new Error(`read as ${st.kind}, not said`);
	}

	return st;
};

/** Text a shell's words would act on: comments, quotes, escapes, pipes, jobs, chains and `$(`. */
const SHELL_BITS = ["&", "|", ";", "#", "'", '"', "\\", "$(", ")", "&&", "||", "#7", "don't"];
const PLAIN = ["a", "why", "twice?", "7", "post", "x.txt", " ", "  ", "\t"];

/** Prose as a person might type it: plain words and shell characters, in any order. */
const prose = fc
	.array(fc.constantFrom(...SHELL_BITS, ...PLAIN), {minLength: 1, maxLength: 12})
	.map((parts) => parts.join(""))
	// Not empty, and not a second mention: `@scout @x` names two agents, which is PR 3's.
	.filter((p) => p.trim() !== "" && !p.startsWith("@") && !p.includes("\n"));

const NAMES = ["scout", "researcher", "r2", "a.b", "x_y-z"];

describe("S-1: the prose of a said line is the line after the mention and its one space, exactly", () => {
	it("holds for any prose, # ' \" \\ & | ; $( included, after any leading spaces", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...NAMES),
				prose,
				fc.constantFrom("", " ", "  "),
				(name, text, lead) => {
					const line = `${lead}@${name} ${text}`;
					const st = said(line);
					const from = lead.length + 1 + name.length + 1;
					expect(st.prose.text).toBe(text);
					expect(st.prose.text).toBe(line.slice(from));
					expect(st.prose.at).toEqual({start: from, end: line.length});
					expect(st.mentions.map((m) => m.name)).toEqual([name]);
					expect(st.mentions[0]?.at).toEqual({
						start: lead.length + 1,
						end: lead.length + 1 + name.length,
					});
					expect(st.room).toBeNull();
					expect(st.background).toBe(false);
					expect(st.text).toBe(line);
				},
			),
			OPTS,
		);
	});

	it("keeps #7 twice? and the quote in don't, which shell words would drop and open", () => {
		const line = "@scout why does post print #7 twice? don't guess; check a | b & c";
		const st = said(line);
		expect(st.prose.text).toBe("why does post print #7 twice? don't guess; check a | b & c");
		expect(st.prose.at).toEqual({start: 7, end: line.length});
		expect(st.mentions).toEqual([{name: "scout", at: {start: 1, end: 6}}]);
	});

	it("is one statement and the whole line: ; and && start no second statement", () => {
		expect(said("@scout a; b").prose.text).toBe("a; b");
		expect(said("@scout a && jobs").prose.text).toBe("a && jobs");
		expect(said("@scout a\\ b 'c").prose.text).toBe("a\\ b 'c");
	});
});

describe("S-2: a said line is one job in the foreground", () => {
	it("@scout a | b & is one said statement, background false, the & kept in its prose", () => {
		const st = said("@scout a | b &");
		expect(st).toMatchObject({kind: "said", background: false, after: null});
		expect(st.prose.text).toBe("a | b &");
	});

	it("holds for any prose that ends with &: never a background job", () => {
		fc.assert(
			fc.property(prose, (text) => {
				const st = said(`@scout ${text} &`);
				expect(st.background).toBe(false);
				expect(st.prose.text).toBe(`${text} &`);
			}),
			OPTS,
		);
	});
});

describe("summon, dismiss and agents are tsh's built-ins", () => {
	it("are in BUILTINS", () => {
		expect(BUILTINS).toEqual(expect.arrayContaining(["summon", "dismiss", "agents"]));
	});

	it("reads each as a built-in with plain words, as today's built-ins are", () => {
		const summon = only("summon fake fake-large high as scout");
		expect(summon).toMatchObject({kind: "builtin", name: "summon", background: false});

		if (summon.kind !== "builtin") {
			throw new Error("not a built-in");
		}

		expect(summon.args.map((a) => a.name)).toEqual(["fake", "fake-large", "high", "as", "scout"]);
		expect(only("dismiss scout")).toMatchObject({kind: "builtin", name: "dismiss"});
		expect(only("agents")).toMatchObject({kind: "builtin", name: "agents"});
	});

	it("leaves a line that only holds an @ later in it as today: a program's line", () => {
		expect(only("say --text a@b").kind).toBe("run");
	});
});
