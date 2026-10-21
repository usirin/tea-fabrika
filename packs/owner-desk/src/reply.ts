import type {AnswerBody} from "@kampus/fabrika/pipeline/asks/ask";
import {readCriterionId} from "@kampus/fabrika/pipeline/ids";

// The owner's reply, typed as words, read into an answer by code: a `/word`
// first, then what it takes. Anything else is not an answer, and nothing is
// guessed from it. The core still checks the answer against its ask.
//
//   /approve
//   /yes
//   /change c3 the list stays sorted after a second run
//   /no not now: nobody needs this yet
//   /remove
//   /keep-going 3
//   /reword c3 When the suite runs twice, both runs pass
//   /rule lasting build Reject when no Subs are active.
//
// In a shell the command already says the words are a reply (tsh's
// `answer --ask <id> --reply "keep-going 3"`), so there the `/` may be left
// out (`typedAnswerOf`). The words after it are read the same way.

/** A reply's answer, or `null`: it is not one. Pure. */
export function answerOf(text: string): AnswerBody | null {
	const match = /^\s*\/([a-z-]+)\s*([\s\S]*)$/.exec(text);
	if (match === null) return null;
	const [, word = "", rest = ""] = match;
	const tail = rest.trim();
	switch (word) {
		case "approve":
			return tail === "" ? {kind: "approve"} : null;
		case "yes":
			return tail === "" ? {kind: "yes"} : null;
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
			const [, id = "", when = "", result = ""] = said;
			const criterion = readCriterionId(id);
			return criterion === null ? null : {kind: "reword", criterion, when, result};
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

/** A reply typed in a shell, its `/` left out or not. `null`: it is not an answer. Pure. */
export const typedAnswerOf = (text: string): AnswerBody | null =>
	answerOf(text.trimStart().startsWith("/") ? text : `/${text.trimStart()}`);
