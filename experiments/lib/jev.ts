// Jev over HTTP for the experiments, with a few retries, and a small pool.
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("set TYPESAFE_API_KEY");

// A run stops at MAX_CALLS (default 5,000): a probe that grew by mistake should
// not spend a day's credit, or look like an attack on TypeSafe.
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 5_000);
let calls = 0;

// Jev bills by the token, not the call: about $0.042 per million (2026-10-05,
// $21.31 for 508M tokens), and a call that carries a whole file is thousands of
// tokens. A run stops at MAX_DOLLARS (default $5), counting about four
// characters a token, and says what it spent when it ends.
const DOLLARS_PER_TOKEN = 0.042 / 1_000_000;
const MAX_DOLLARS = Number(process.env.MAX_DOLLARS ?? 5);
let tokens = 0;
const spent = () => tokens * DOLLARS_PER_TOKEN;
process.on("exit", () => {
  if (calls > 0) console.log(`jev: ${calls} calls, ~${Math.round(tokens / 1e6)}M tokens, ~$${spent().toFixed(2)}`);
});

// Only a rate limit or a server error is worth asking again; a 402 or any other
// refusal will answer the same way, so retrying it just hammers the API.
const retryable = (status: number) => status === 429 || status >= 500;

export interface Answer {
  readonly choice: string;
  readonly confidence: number;
  /** The share Jev gave each option. They add up to 1. */
  readonly probabilities: Readonly<Record<string, number>>;
}

/** One call to Jev: every question in the map, answered about `state`. */
export async function askAll(questions: object, state: object): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    if (++calls > MAX_CALLS) throw new Error(`stopped at MAX_CALLS=${MAX_CALLS}`);
    if (spent() > MAX_DOLLARS) throw new Error(`stopped at MAX_DOLLARS=${MAX_DOLLARS}`);
    const body = JSON.stringify({ model: "jev-latest", questions, state });
    tokens += body.length / 4;
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body,
    });
    if (res.ok) return ((await res.json()) as { answers: Record<string, unknown> }).answers;
    if (!retryable(res.status) || attempt >= 4) throw new Error(`Jev answered ${res.status}`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Ask Jev one question map about `state` and hand back the choice answer to `name`. */
export async function ask(questions: object, name: string, state: object): Promise<Answer> {
  const answer = (await askAll(questions, state))[name] as Answer | undefined;
  if (answer === undefined) throw new Error(`Jev did not answer ${name}`);
  return { choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities };
}

/** Run `work` over `items`, at most `limit` at a time. */
export async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index] as T);
      }
    }),
  );
  return results;
}
