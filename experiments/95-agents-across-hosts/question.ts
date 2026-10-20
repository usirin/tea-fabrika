// The questions the asker asks, and how an answer is checked. Pure: the asker's machine, the
// stub agent and the harness all read the same functions, so "the right answer" is one rule.
//
//   questionOf(17)  {id: "q-17", corr: "asker:1#17", text: "What is 40 + 75?", expected: 115}
//   stubAnswer("What is 40 + 75?")   "115"
//   isRight(questionOf(17), "The answer is 115.")   true

export interface Question {
	/** The message id: the answerer's idempotency key. The same on every retry of the call. */
	readonly id: string;
	/** The correlation id the reply carries back: OTP's call reference. */
	readonly corr: string;
	readonly text: string;
	readonly expected: number;
}

/** In real mode the one question: small, and checkable without reading the prose around it. */
export const REAL_QUESTION = {
	text: "What is 17 times 23? Answer with the number only.",
	expected: 391,
} as const;

export const questionOf = (i: number, real = false): Question => {
	if (real) return {id: `q-${i}`, corr: `asker:1#${i}`, ...REAL_QUESTION} satisfies Question;
	const a = ((i * 37) % 97) + 3;
	const b = ((i * 53) % 89) + 5;
	const times = i % 3 === 0;
	return {
		id: `q-${i}`,
		corr: `asker:1#${i}`,
		text: `What is ${a} ${times ? "times" : "+"} ${b}?`,
		expected: times ? a * b : a + b,
	};
};

/** The index a message id names, or `null`. */
export const indexOf = (id: string): number | null => {
	const m = /^q-(\d+)$/.exec(id);
	return m === null ? null : Number(m[1]);
};

/** The first whole number in an answer, so "391", "391." and "The answer is 391" all read 391. */
export const numberIn = (answer: string): number | null => {
	const m = /-?\d+/.exec(answer.replace(/,(?=\d{3})/g, ""));
	return m === null ? null : Number(m[0]);
};

export const isRight = (q: Question, answer: string): boolean => numberIn(answer) === q.expected;

/** The stub agent: deterministic, so every answer is checkable. A question it cannot read gets "?". */
export const stubAnswer = (text: string): string => {
	const m = /What is (-?\d+) (\+|times) (-?\d+)\?/.exec(text);
	if (m === null) return "?";
	const a = Number(m[1]);
	const b = Number(m[3]);
	return String(m[2] === "+" ? a + b : a * b);
};
