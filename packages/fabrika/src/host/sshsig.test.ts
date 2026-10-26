import {describe, expect, it} from "vitest";
import {keyLineOf, keyOnly, parse, sign, verify} from "./sshsig.ts";

// A signature `ssh-keygen -Y sign -n fabrika-ledger` made, with a key made for this test and thrown
// away. Only its public half is here. `ssh-keygen -Y verify` said: Good "fabrika-ledger" signature.
const OPENSSH_KEY =
	"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIETuSGZxryszIPBvnpi+QdpZR0FTah8q8SCLcnheuzi8 test key";
const OPENSSH_MESSAGE = "fabrika ledger login\nledger: http://127.0.0.1/demo\n";
const OPENSSH_SIGNATURE = `-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgRO5IZnGvKzMg8G+emL5B2llHQV
NqHyrxIItyeF67OLwAAAAOZmFicmlrYS1sZWRnZXIAAAAAAAAABnNoYTUxMgAAAFMAAAAL
c3NoLWVkMjU1MTkAAABAEqbZk0vDRcNAJWoztY1z0e/kVixW3mK/zLMKdMF1ukVmE4HSLr
pNUjQeOHf/WEprXNpiEeyriUSf9QIU+K9oDQ==
-----END SSH SIGNATURE-----`;

const NS = "fabrika-ledger";

const newKey = async () => {
	const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
	return {key: pair.privateKey, raw, line: keyLineOf(raw)};
};

describe("an SSH signature", () => {
	it("made by ssh-keygen is checked against the key that made it", async () => {
		expect(await verify(OPENSSH_SIGNATURE, OPENSSH_MESSAGE, NS, [OPENSSH_KEY])).toBe(OPENSSH_KEY);
	});

	it("made here reads back with its namespace and key", async () => {
		const k = await newKey();
		const sig = await sign("hello", NS, k.key, k.raw);
		expect(parse(sig)?.namespace).toBe(NS);
		expect(await verify(sig, "hello", NS, [`${k.line} a comment`])).toBe(`${k.line} a comment`);
		expect(keyOnly(`${k.line} a comment`)).toBe(k.line);
	});

	it("is no signature for another message, namespace or key", async () => {
		const k = await newKey();
		const other = await newKey();
		const sig = await sign("hello", NS, k.key, k.raw);
		expect(await verify(sig, "hello!", NS, [k.line])).toBeNull();
		expect(await verify(sig, "hello", "git", [k.line])).toBeNull();
		expect(await verify(sig, "hello", NS, [other.line])).toBeNull();
		expect(await verify(sig, "hello", NS, [])).toBeNull();
		// ssh-keygen's, checked against a key GitHub could list for someone else.
		expect(await verify(OPENSSH_SIGNATURE, OPENSSH_MESSAGE, NS, [k.line])).toBeNull();
	});

	it("that was changed or cut does not read", async () => {
		const k = await newKey();
		const sig = await sign("hello", NS, k.key, k.raw);
		const lines = sig.split("\n");
		const body = lines.slice(1, -1).join("");
		const flipped = `${body.slice(0, 40)}${body[40] === "A" ? "B" : "A"}${body.slice(41)}`;
		const changed = [lines[0], flipped, lines.at(-1)].join("\n");
		expect(await verify(changed, "hello", NS, [k.line])).toBeNull();
		expect(parse(sig.replace("BEGIN", "START"))).toBeNull();
		expect(parse([lines[0], body.slice(0, 60), lines.at(-1)].join("\n"))).toBeNull();
		expect(parse("")).toBeNull();
	});

	it("reads no key line but Ed25519's", () => {
		expect(keyOnly("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ")).toBeNull();
		expect(keyOnly("ssh-ed25519 not-base64!")).toBeNull();
		expect(keyOnly("")).toBeNull();
	});
});
