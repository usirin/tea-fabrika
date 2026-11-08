// Recorded browser assertion -> SSHSIG -> WebCrypto and OpenSSH, plus independent policy controls.
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {Schema} from "effect";

const TEXT = "P10 passkey SSHSIG spike\n";
const SPACE = "fabrika-client";
const RP = "fabrika.test";
const ORIGIN = `https://${RP}`;
const KEY = "sk-ecdsa-sha2-nistp256@openssh.com";
const SIG = "webauthn-sk-ecdsa-sha2-nistp256@openssh.com";
const hash = (name: string, bytes: Uint8Array | string) => createHash(name).update(bytes).digest();
const u32 = (n: number) => {
	const b = Buffer.alloc(4);
	b.writeUInt32BE(n);
	return b;
};
const field = (value: string | Uint8Array) => {
	const b = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
	return Buffer.concat([u32(b.length), b]);
};
const signed = (text: string, space: string) =>
	Buffer.concat([
		Buffer.from("SSHSIG"),
		field(space),
		field(""),
		field("sha512"),
		field(hash("sha512", text)),
	]);
const armor = (bytes: Uint8Array) =>
	`-----BEGIN SSH SIGNATURE-----\n${Buffer.from(bytes)
		.toString("base64")
		.match(/.{1,70}/g)
		?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
const unarmor = (text: string) => {
	assert(text.startsWith("-----BEGIN SSH SIGNATURE-----\n"));
	assert(text.trimEnd().endsWith("\n-----END SSH SIGNATURE-----"));
	const body = text.trimEnd().split("\n").slice(1, -1).join("");
	const bytes = Buffer.from(body, "base64");
	assert.equal(bytes.toString("base64"), body);
	return bytes;
};
const reader = (bytes: Buffer) => {
	let at = 0;
	const take = (n: number) => {
		assert(n >= 0 && at + n <= bytes.length);
		const b = bytes.subarray(at, at + n);
		at += n;
		return b;
	};
	const word = () => take(4).readUInt32BE();
	return {take, word, field: () => take(word()), end: () => assert.equal(at, bytes.length)};
};
const fixed = (mpint: Buffer) => {
	assert(mpint.length > 0 && mpint.length <= 33 && mpint[0] !== undefined && mpint[0] < 0x80);
	assert(mpint.length === 1 || mpint[0] !== 0 || (mpint[1] !== undefined && mpint[1] >= 0x80));
	const n = mpint[0] === 0 ? mpint.subarray(1) : mpint;
	assert(n.length <= 32);
	return Buffer.concat([Buffer.alloc(32 - n.length), n]);
};
const mpint = (n: Buffer) => {
	let at = 0;
	while (n[at] === 0) at++;
	const b = n.subarray(at);
	return field(b[0] !== undefined && b[0] >= 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
};
type Parts = {
	point: Buffer;
	rp: string;
	space: string;
	flags: number;
	counter: number;
	origin: string;
	client: Buffer;
	extensions: Buffer;
	signature: Buffer;
};
const parse = (text: string): Parts => {
	const b = reader(unarmor(text));
	assert.equal(b.take(6).toString(), "SSHSIG");
	assert.equal(b.word(), 1);
	const key = reader(b.field());
	assert.equal(key.field().toString(), KEY);
	assert.equal(key.field().toString(), "nistp256");
	const point = key.field();
	assert(point.length === 65 && point[0] === 4);
	const rp = key.field().toString();
	key.end();
	const space = b.field().toString();
	b.field();
	assert.equal(b.field().toString(), "sha512");
	const sig = reader(b.field());
	b.end();
	assert.equal(sig.field().toString(), SIG);
	const ints = reader(sig.field());
	const signature = Buffer.concat([fixed(ints.field()), fixed(ints.field())]);
	ints.end();
	const flags = sig.take(1)[0];
	assert(flags !== undefined);
	const counter = sig.word();
	const origin = sig.field().toString();
	const client = sig.field();
	const extensions = sig.field();
	sig.end();
	return {point, rp, space, flags, counter, origin, client, extensions, signature};
};
const keyBlob = (p: Parts) =>
	Buffer.concat([field(KEY), field("nistp256"), field(p.point), field(p.rp)]);
const encode = (p: Parts) =>
	armor(
		Buffer.concat([
			Buffer.from("SSHSIG"),
			u32(1),
			field(keyBlob(p)),
			field(p.space),
			field(""),
			field("sha512"),
			field(
				Buffer.concat([
					field(SIG),
					field(
						Buffer.concat([mpint(p.signature.subarray(0, 32)), mpint(p.signature.subarray(32))]),
					),
					Buffer.from([p.flags]),
					u32(p.counter),
					field(p.origin),
					field(p.client),
					field(p.extensions),
				]),
			),
		]),
	);
const original = execFileSync(
	process.execPath,
	[fileURLToPath(new URL("./230-passkey-sshsig.ts", import.meta.url)), "--pack"],
	{encoding: "utf8"},
);
const good = parse(original);
assert.equal(encode(good), original);
assert.equal(good.flags, 0x1d);
assert.equal(good.counter, 0);
const Client = Schema.Struct({
	type: Schema.String,
	challenge: Schema.String,
	origin: Schema.String,
	crossOrigin: Schema.optional(Schema.Boolean),
});
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Client));
const auth = (p: Parts) =>
	Buffer.concat([hash("sha256", p.rp), Buffer.from([p.flags]), u32(p.counter), p.extensions]);
const captured = Schema.decodeUnknownSync(
	Schema.fromJsonString(
		Schema.Struct({
			authenticatorData: Schema.String,
			publicKey: Schema.String,
			browser: Schema.String,
		}),
	),
)(readFileSync(new URL("./results/230-assertion.json", import.meta.url), "utf8"));
assert.deepEqual(auth(good), Buffer.from(captured.authenticatorData, "base64url"));
assert.deepEqual(good.point, Buffer.from(captured.publicKey, "base64url"));
const signatureValid = async (p: Parts) => {
	const key = await crypto.subtle.importKey(
		"raw",
		p.point,
		{name: "ECDSA", namedCurve: "P-256"},
		false,
		["verify"],
	);
	return crypto.subtle.verify(
		{name: "ECDSA", hash: "SHA-256"},
		key,
		p.signature,
		Buffer.concat([auth(p), hash("sha256", p.client)]),
	);
};
type Expected = {
	text: string;
	space: string;
	rp: string;
	origins: ReadonlyArray<string>;
	point: Buffer;
};
const expected: Expected = {text: TEXT, space: SPACE, rp: RP, origins: [ORIGIN], point: good.point};
const check = async (text: string, want: Expected) => {
	try {
		const p = parse(text);
		const cryptoValid = await signatureValid(p);
		const no = (why: string) => ({policy: false, why, crypto: cryptoValid});
		if (!p.point.equals(want.point)) return no("key");
		if (p.space !== want.space) return no("namespace");
		if (p.rp !== want.rp) return no("rp");
		const client = decode(p.client.toString());
		if (client.type !== "webauthn.get") return no("type");
		if (client.challenge !== signed(want.text, want.space).toString("base64url"))
			return no("challenge");
		if (client.origin !== p.origin || !want.origins.includes(p.origin)) return no("origin");
		if (client.crossOrigin === true) return no("cross_origin");
		if ((p.flags & 1) === 0) return no("up");
		if ((p.flags & 4) === 0) return no("uv");
		if ((p.flags & 16) !== 0 && (p.flags & 8) === 0) return no("backup");
		if ((p.flags & 0x62) !== 0) return no("flags");
		if (((p.flags & 0x80) !== 0) !== p.extensions.length > 0) return no("extensions");
		return cryptoValid ? {policy: true, why: "ok", crypto: true} : no("signature");
	} catch {
		return {policy: false, why: "format", crypto: false};
	}
};
const directory = mkdtempSync(join(tmpdir(), "p10-verify-"));
const openssh = (armored: string, text: string, space: string, signer: Parts) => {
	writeFileSync(
		join(directory, "allowed_signers"),
		`spike ${KEY} ${keyBlob(signer).toString("base64")}\n`,
	);
	writeFileSync(join(directory, "assertion.sig"), armored);
	const result = spawnSync(
		"ssh-keygen",
		[
			"-Y",
			"verify",
			"-n",
			space,
			"-I",
			"spike",
			"-f",
			join(directory, "allowed_signers"),
			"-s",
			join(directory, "assertion.sig"),
		],
		{input: text, encoding: "utf8"},
	);
	assert.equal(
		result.error,
		undefined,
		"ssh-keygen must start; an unavailable checker is not a failed signature",
	);
	assert.equal(result.signal, null, "ssh-keygen must exit normally");
	return {
		ok: result.status === 0,
		exit: result.status,
		output: `${result.stdout}${result.stderr}`.trim(),
	};
};
const changeClient = (values: Record<string, string | boolean>) =>
	Buffer.from(JSON.stringify({...decode(good.client.toString()), ...values}));
const flip = (bytes: Buffer) => {
	const b = Buffer.from(bytes);
	const at = b.length - 1;
	b[at] = (b[at] ?? 0) ^ 1;
	return b;
};
type Case = {
	name: string;
	armored: string;
	want: Expected;
	why: string;
	crypto: boolean;
	ssh?: boolean;
	signer: Parts;
};
const cases: Array<Case> = [];
const add = (
	name: string,
	parts: Partial<Parts>,
	why: string,
	cryptoValid: boolean,
	ssh?: boolean,
	want: Partial<Expected> = {},
) =>
	cases.push({
		name,
		armored: encode({...good, ...parts}),
		want: {...expected, ...want},
		why,
		crypto: cryptoValid,
		ssh,
		signer: good,
	});
add("real Chromium assertion, BE/BS and zero counter", {}, "ok", true, true);
add("changed text", {}, "challenge", true, false, {text: `${TEXT}!`});
add("changed expected namespace", {}, "namespace", true, false, {space: "other"});
add("wrong configured RP", {}, "rp", true, true, {rp: "other.test"});
add("foreign configured origin", {}, "origin", true, true, {origins: ["https://other.test"]});
add(
	"changed challenge",
	{client: changeClient({challenge: flip(signed(TEXT, SPACE)).toString("base64url")})},
	"challenge",
	false,
	false,
);
add(
	"challenge is only the text hash",
	{client: changeClient({challenge: hash("sha512", TEXT).toString("base64url")})},
	"challenge",
	false,
	false,
);
add(
	"wrong assertion type",
	{client: changeClient({type: "webauthn.create"})},
	"type",
	false,
	false,
);
add(
	"changed client origin",
	{client: changeClient({origin: "https://other.test"})},
	"origin",
	false,
	false,
);
add("changed wrapper origin", {origin: "https://other.test"}, "origin", true, false);
add(
	"cross-origin client",
	{client: changeClient({crossOrigin: true})},
	"cross_origin",
	false,
	false,
);
add("UV cleared", {flags: good.flags & ~4}, "uv", false, false);
add("UP cleared", {flags: good.flags & ~1}, "up", false, false);
add("BS without BE", {flags: good.flags & ~8}, "backup", false, false);
add("BS cleared", {flags: good.flags & ~16}, "signature", false, false);
add("reserved flag set", {flags: good.flags | 2}, "flags", false, false);
add("counter changed", {counter: 1}, "signature", false, false);
add("RP application bytes changed", {rp: "other.test"}, "signature", false, false, {
	rp: "other.test",
});
add("one signature byte changed", {signature: flip(good.signature)}, "signature", false, false);
add(
	"original client data reformatted",
	{client: Buffer.concat([good.client, Buffer.from(" ")])},
	"signature",
	false,
	false,
);
add("ED set, extensions absent", {flags: good.flags | 0x80}, "extensions", false, false);
add("extensions present, ED absent", {extensions: Buffer.from([0xa0])}, "extensions", false, false);
for (const [name, blob] of [
	["trailing byte", Buffer.concat([unarmor(original), Buffer.from([0])])],
	["truncated blob", unarmor(original).subarray(0, -1)],
] satisfies Array<[string, Buffer]>)
	cases.push({
		name,
		armored: armor(blob),
		want: expected,
		why: "format",
		crypto: false,
		ssh: false,
		signer: good,
	});

// Synthetic controls are clearly separate from the recorded browser fixture. Each has a good
// P-256 signature, so a policy refusal cannot hide behind unrelated broken cryptography.
const pair = await crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, [
	"sign",
	"verify",
]);
const point = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey));
for (const [name, flags, why] of [
	["synthetic BE=0 BS=0", 5, "ok"],
	["synthetic BE=1 BS=0", 13, "ok"],
	["synthetic BE=1 BS=1", 29, "ok"],
	["synthetic BE=0 BS=1", 21, "backup"],
	["synthetic UP without UV", 1, "uv"],
] satisfies Array<[string, number, string]>) {
	const p = {...good, point, flags};
	p.signature = Buffer.from(
		await crypto.subtle.sign(
			{name: "ECDSA", hash: "SHA-256"},
			pair.privateKey,
			Buffer.concat([auth(p), hash("sha256", p.client)]),
		),
	);
	cases.push({name, armored: encode(p), want: {...expected, point}, why, crypto: true, signer: p});
}
const results = [];
try {
	for (const test of cases) {
		const web = await check(test.armored, test.want);
		const ssh = openssh(test.armored, test.want.text, test.want.space, test.signer);
		assert.equal(web.why, test.why, test.name);
		assert.equal(web.crypto, test.crypto, test.name);
		assert.equal(web.policy, test.why === "ok", test.name);
		if (test.ssh !== undefined) assert.equal(ssh.ok, test.ssh, test.name);
		results.push({
			name: test.name,
			armored: test.armored,
			signer: `${KEY} ${keyBlob(test.signer).toString("base64")}`,
			webcrypto: web,
			openssh: ssh,
		});
		console.log(`${test.name}: policy=${web.why}, crypto=${web.crypto}, ssh=${ssh.ok}`);
	}
	writeFileSync(
		new URL("./results/230-checks.json", import.meta.url),
		`${JSON.stringify(
			{
				fixture: "230-assertion.json",
				fixtureSha256: hash(
					"sha256",
					readFileSync(new URL("./results/230-assertion.json", import.meta.url)),
				).toString("hex"),
				message: TEXT,
				namespace: SPACE,
				challengeHex: signed(TEXT, SPACE).toString("hex"),
				openssh: spawnSync("ssh", ["-V"], {encoding: "utf8"}).stderr.trim(),
				assertion: {flags: good.flags, counter: good.counter, rp: good.rp, origin: good.origin},
				browser: Buffer.from(captured.browser, "base64url").toString(),
				results,
			},
			null,
			2,
		)}\n`,
	);
} finally {
	rmSync(directory, {recursive: true, force: true});
}
