// A session: who is calling, signed by the server's secret. A stand-in for the Door's login
// (pull request 92: an SSH signature checked against GitHub's keys, then a short session). Here
// the test or the script mints the session itself with the secret, so no login code is copied.
//
// Runs in Node and in workerd, so it uses only the Web Crypto API and has no imports. Erasable
// TypeScript: workerd gets it with its types stripped.

/** A person, or an agent working for one. Ids are GitHub's numeric ids: `github:<n>`. */
export type Who =
	| {readonly kind: "user"; readonly id: string}
	| {readonly kind: "agent"; readonly id: string; readonly for: string};

const PERSON = /^github:[1-9][0-9]{0,11}$/;
const enc = new TextEncoder();

const b64 = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
/** The bytes of a base64url text, or null: it is not base64. */
const unb64 = (s: string): Uint8Array<ArrayBuffer> | null => {
	try {
		return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
};
const parse = (bytes: Uint8Array<ArrayBuffer>): unknown => {
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
};

const keyOf = (secret: string) =>
	crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, [
		"sign",
		"verify",
	]);

/** A session for `who`, good for `ttlMs`. */
export const mint = async (secret: string, who: Who, ttlMs: number, now = Date.now()) => {
	const body = b64(enc.encode(JSON.stringify({...who, exp: now + ttlMs})));
	const sig = await crypto.subtle.sign("HMAC", await keyOf(secret), enc.encode(body));
	return `${body}.${b64(new Uint8Array(sig))}`;
};

/** Who a session names, or null: no session, a bad signature, a bad shape, or run out. */
export const verify = async (
	secret: string,
	token: string | null,
	now = Date.now(),
): Promise<Who | null> => {
	const [body, sig, more] = (token ?? "").split(".");
	if (!body || !sig || more !== undefined) return null;
	const sigBytes = unb64(sig);
	const bodyBytes = unb64(body);
	if (sigBytes === null || bodyBytes === null) return null;
	const good = await crypto.subtle.verify("HMAC", await keyOf(secret), sigBytes, enc.encode(body));
	if (!good) return null;
	const v = parse(bodyBytes);
	if (typeof v !== "object" || v === null) return null;
	const exp = Reflect.get(v, "exp");
	const kind = Reflect.get(v, "kind");
	const id = Reflect.get(v, "id");
	const of = Reflect.get(v, "for");
	if (typeof exp !== "number" || exp <= now || typeof id !== "string") return null;
	if (kind === "user" && PERSON.test(id)) return {kind, id};
	if (kind === "agent" && typeof of === "string" && PERSON.test(of) && id.startsWith(`${of}.`))
		return {kind, id, for: of};
	return null;
};
