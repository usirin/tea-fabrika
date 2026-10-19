import type {AnswerBody} from "@tea-fabrika/wip/asks/ask";

// The owner's reply, typed as words, read into an answer by code: a `/word`
// first, then what it takes. Anything else is not an answer, and nothing is
// guessed from it. The core still checks the answer against its ask.
//
//   /approve
//   /change t1.c2 the list stays sorted after a second run
//   /no not now: nobody needs this yet
//   /remove
//   /keep-going 3
//   /reword t1.c2 When the suite runs twice, both runs pass
//   /rule lasting build Reject when no Subs are active.

/** A reply's answer, or `null`: it is not one. Pure. */
export function answerOf(text: string): AnswerBody | null {
	const match = /^\s*\/([a-z-]+)\s*([\s\S]*)$/.exec(text);
	if (match === null) return null;
	const [, word = "", rest = ""] = match;
	const tail = rest.trim();
	switch (word) {
		case "approve":
			return tail === "" ? {kind: "approve"} : null;
		case "no":
			return tail === "" ? null : {kind: "no", why: tail};
		case "change": {
			const [line = "", ...to] = tail.split(/\s+/);
			return line === "" || to.length === 0 ? null : {kind: "change", line, to: to.join(" ")};
		}
		case "remove":
			return tail === "" ? {kind: "remove"} : null;
		case "keep-going": {
			const rounds = Number(tail);
			return Number.isInteger(rounds) && rounds >= 1 && rounds <= 10
				? {kind: "keep_going", rounds}
				: null;
		}
		case "reword": {
			const said = /^(\S+)\s+When\s+(.+?),\s+(.+)$/s.exec(tail);
			if (said === null) return null;
			const [, line = "", when = "", result = ""] = said;
			return {kind: "reword", line, when, result};
		}
		case "rule": {
			const said = /^(lasting|one-off)\s+(build\s+)?(.+)$/s.exec(tail);
			if (said === null) return null;
			const [, rule, build, answer = ""] = said;
			return {
				kind: "rule",
				answer: answer.trim(),
				rule: rule === "lasting" ? "lasting" : "one_off",
				build: build !== undefined,
			};
		}
		default:
			return null;
	}
}
