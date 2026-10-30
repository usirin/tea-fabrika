// One Responses API call on a SIWC pass, as OpenAI's "Models and inference" page asks: the pass as
// a bearer to POST /v1/responses, `store: false` and `stream: true` on every call. The answer is
// read off the event stream: the text deltas and the usage in `response.completed`.
//
//   yield* ask("https://api.openai.com/v1", pass, "", "Say hi in two words.")
//   // {text: "Hi there", input_tokens: 12, output_tokens: 3}
//
// With no model named, the account's own catalog (GET /v1/models) picks one: the first whose id
// has "mini", else the first.
import {Effect, Redacted} from "effect";

interface Asked {
	readonly text: string;
	readonly input_tokens: number | null;
	readonly output_tokens: number | null;
}

const failed = (why: string) => ({_tag: "unreachable" as const, why});

const pickModel = (api: string, pass: Redacted.Redacted<string>) =>
	Effect.tryPromise({
		try: async () => {
			const res = await fetch(`${api}/models`, {
				headers: {authorization: `Bearer ${Redacted.value(pass)}`},
			});
			if (!res.ok) throw new Error(`models: http ${res.status}`);
			const j = (await res.json()) as {data?: {id?: unknown}[]};
			const ids = (j.data ?? []).flatMap((m) => (typeof m.id === "string" ? [m.id] : []));
			const pick = ids.find((id) => id.includes("mini")) ?? ids[0];
			if (pick === undefined) throw new Error("models: none listed");
			return pick;
		},
		catch: (e) => failed(String(e).slice(0, 120)),
	});

/** The call itself, on fetch: it rejects with the API's error code, which `ask` maps. */
const call = async (
	api: string,
	pass: Redacted.Redacted<string>,
	name: string,
	prompt: string,
): Promise<Asked> => {
	const res = await fetch(`${api}/responses`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${Redacted.value(pass)}`,
			"content-type": "application/json",
			accept: "text/event-stream",
		},
		body: JSON.stringify({model: name, input: prompt, store: false, stream: true}),
	});
	if (!res.ok || res.body === null) {
		const body = await res.text().catch(() => "");
		let code = `http_${res.status}`;
		try {
			const e = (JSON.parse(body) as {error?: {code?: unknown}}).error?.code;
			if (typeof e === "string") code = e;
		} catch {
			// not JSON
		}
		throw new Error(code);
	}
	let text = "";
	let usage: {input_tokens?: number; output_tokens?: number} = {};
	let failure: string | null = null;
	let buf = "";
	const decoder = new TextDecoder();
	for await (const chunk of res.body) {
		buf += decoder.decode(chunk, {stream: true});
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.startsWith("data:")) continue;
			const data = line.slice(5).trim();
			if (data === "" || data === "[DONE]") continue;
			const ev = JSON.parse(data) as {
				type?: string;
				delta?: string;
				response?: {usage?: typeof usage; error?: {code?: string}};
			};
			if (ev.type === "response.output_text.delta" && typeof ev.delta === "string")
				text += ev.delta;
			if (ev.type === "response.completed") usage = ev.response?.usage ?? {};
			if (ev.type === "response.failed") failure = ev.response?.error?.code ?? "failed";
		}
	}
	if (failure !== null) throw new Error(failure);
	return {
		text: text.slice(0, 80),
		input_tokens: usage.input_tokens ?? null,
		output_tokens: usage.output_tokens ?? null,
	};
};

export const ask = (api: string, pass: Redacted.Redacted<string>, model: string, prompt: string) =>
	Effect.gen(function* () {
		const name = model === "" ? yield* pickModel(api, pass) : model;
		return yield* Effect.tryPromise({
			try: () => call(api, pass, name, prompt),
			catch: (e) => failed(e instanceof Error ? e.message.slice(0, 120) : "failed"),
		});
	});
