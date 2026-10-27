// Experiment 157's allow list: every host and path a box may reach, and what the Worker does with
// each. Anything else is refused. Experiment 137's relay rules, as plain functions with no imports.
//
//   anthropic.internal  POST /v1/messages, only `?beta=true`, max_tokens up to 64,000
//                       -> the box's bearer is dropped, the locker's token goes on
//   chatgpt.internal    POST /backend-api/codex/responses
//                       -> passed on as it is: the box holds its own lent auth.json
//   auth.internal       POST /oauth/token
//                       -> passed on; with `catch`, the answer is kept in the locker first
//   ping.internal       GET /ping, the driver's timing probe: answered by the Worker itself
//
// Locally the names are made up, so not one byte can reach Anthropic or OpenAI. On Cloudflare the
// same table would name api.anthropic.com, chatgpt.com and auth.openai.com.

export type Kind = "claude" | "codex" | "token" | "ping";

interface Route {
	readonly kind: Kind;
	readonly host: string;
	readonly method: string;
	readonly path: string;
	/** Query names allowed, each with the one value allowed. */
	readonly query: Readonly<Record<string, string>>;
	readonly maxTokens: number | null;
}

export const ROUTES: readonly Route[] = [
	{
		kind: "claude",
		host: "anthropic.internal",
		method: "POST",
		path: "/v1/messages",
		query: {beta: "true"},
		maxTokens: 64_000,
	},
	{
		kind: "codex",
		host: "chatgpt.internal",
		method: "POST",
		path: "/backend-api/codex/responses",
		query: {},
		maxTokens: null,
	},
	{
		kind: "token",
		host: "auth.internal",
		method: "POST",
		path: "/oauth/token",
		query: {},
		maxTokens: null,
	},
	{kind: "ping", host: "ping.internal", method: "GET", path: "/ping", query: {}, maxTokens: null},
];

/** The models a box may ask for. */
export const MODELS: Readonly<Record<"claude" | "codex", readonly string[]>> = {
	claude: ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
	codex: ["gpt-6-luna"],
};

/** The route a call takes, or why it is refused. */
export const routeOf = (method: string, url: URL, body: string): Route | string => {
	const route = ROUTES.find(
		(r) => r.host === url.hostname && r.method === method && r.path === url.pathname,
	);
	if (route === undefined) return `${method} ${url.hostname}${url.pathname} is not on the list`;
	for (const [k, v] of url.searchParams)
		if (route.query[k] !== v) return `query ${k} is not allowed`;
	if (route.kind !== "claude" && route.kind !== "codex") return route;
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(body);
	} catch {
		return "the body is not JSON";
	}
	if (typeof parsed !== "object" || parsed === null) return "the body is not JSON";
	const model = "model" in parsed ? parsed.model : undefined;
	if (typeof model !== "string" || !MODELS[route.kind].includes(model))
		return `model ${String(model)} is not allowed`;
	const max = "max_tokens" in parsed ? parsed.max_tokens : undefined;
	if (route.maxTokens !== null && typeof max === "number" && max > route.maxTokens)
		return `max_tokens ${max} is over ${route.maxTokens}`;
	return route;
};

/** Never passed on from a box to Anthropic: the locker adds the one credential. */
const CREDENTIALS = ["authorization", "x-api-key", "cookie", "proxy-authorization"];
const CLAUDE_PASS = ["content-type", "accept", "anthropic-version", "anthropic-beta", "user-agent"];

/** The headers a Claude call goes on with: the box's own, minus credentials, plus the token. */
export const claudeHeaders = (from: Headers, token: string): Headers => {
	const out = new Headers();
	for (const [name, value] of from)
		if (
			!CREDENTIALS.includes(name) &&
			(CLAUDE_PASS.includes(name) || name.startsWith("x-stainless-"))
		)
			out.set(name, value);
	out.set("authorization", `Bearer ${token}`);
	// A subscription login talks with the OAuth beta, as experiment 137 found Claude Code does.
	const betas = (from.get("anthropic-beta") ?? "").split(",").map((b) => b.trim());
	out.set("anthropic-beta", [...new Set([...betas.filter(Boolean), "oauth-2025-04-20"])].join(","));
	return out;
};

/** Response headers passed back to the box. */
export const headersBack = (from: Headers): Headers => {
	const out = new Headers();
	for (const name of ["content-type", "request-id", "x-request-id", "retry-after"]) {
		const v = from.get(name);
		if (v !== null) out.set(name, v);
	}
	return out;
};
