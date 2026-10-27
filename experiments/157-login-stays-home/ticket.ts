// Experiment 157's person keys: a short signed note that names one person, made with the Worker's
// own secret. The person's app holds it, and every call to the front door carries it. A box never
// sees one: what a box is comes from the props its own object sets.
//
//   const key = await mint(secret, {kind: "person", person: "a", until: Date.now() + 600_000});
//   await verify(secret, key, "person")   // {kind: "person", person: "a", until: ...}
//
// The form is `t1.<payload>.<HMAC-SHA256 of the payload>`, both base64url. Web Crypto only, and
// erasable TypeScript with no imports, so the same file runs in the Worker and in Node.

export type Pass = {readonly kind: "person"; readonly person: string; readonly until: number};

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");

const unb64url = (s: string) =>
	Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

const hmac = (secret: string) =>
	crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, [
		"sign",
		"verify",
	]);

/** A person's id: short, plain, no dots. */
const NAME = /^[a-z0-9-]{1,40}$/;

export const mint = async (secret: string, pass: Pass): Promise<string> => {
	const body = b64url(enc.encode(JSON.stringify(pass)));
	const sig = new Uint8Array(
		await crypto.subtle.sign("HMAC", await hmac(secret), enc.encode(body)),
	);
	return `t1.${body}.${b64url(sig)}`;
};

/** The pass a key carries, when it is ours, of this kind, and not past its time. Else null. */
export const verify = async (
	secret: string,
	key: string,
	kind: Pass["kind"],
	now = Date.now(),
): Promise<Pass | null> => {
	const [v, body, sig] = key.split(".");
	if (v !== "t1" || body === undefined || sig === undefined) return null;
	let ok = false;
	try {
		ok = await crypto.subtle.verify("HMAC", await hmac(secret), unb64url(sig), enc.encode(body));
	} catch {
		return null;
	}
	if (!ok) return null;
	let p: Record<string, unknown>;
	try {
		p = JSON.parse(new TextDecoder().decode(unb64url(body)));
	} catch {
		return null;
	}
	if (p.kind !== kind || typeof p.person !== "string" || !NAME.test(p.person)) return null;
	if (typeof p.until !== "number" || p.until < now) return null;
	return {kind, person: p.person, until: p.until};
};
