// Jev over HTTP for the experiments, with a few retries, and a small pool.
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("set TYPESAFE_API_KEY");

export interface Answer {
  readonly choice: string;
  readonly confidence: number;
  /** The share Jev gave each option. They add up to 1. */
  readonly probabilities: Readonly<Record<string, number>>;
}

/** One call to Jev: every question in the map, answered about `state`. */
export async function askAll(questions: object, state: object): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", questions, state }),
    });
    if (res.ok) return ((await res.json()) as { answers: Record<string, unknown> }).answers;
    if (attempt >= 4) throw new Error(`Jev answered ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
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
