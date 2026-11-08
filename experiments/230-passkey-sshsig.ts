// No arguments prints exactly the SSHSIG signed-data hex that 230-capture.ts must sign.
// --pack reads that public capture and prints the complete SSHSIG armor, without verifying it.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {Schema} from "effect";

const message = "P10 passkey SSHSIG spike\n";
const namespace = "fabrika-client";
const hash = "sha512";
const keyAlgorithm = "sk-ecdsa-sha2-nistp256@openssh.com";
const signatureAlgorithm = "webauthn-sk-ecdsa-sha2-nistp256@openssh.com";

const u32 = (value: number): Buffer => {
	const bytes = Buffer.alloc(4);
	bytes.writeUInt32BE(value);
	return bytes;
};
const field = (value: string | Uint8Array): Buffer => {
	const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
	return Buffer.concat([u32(bytes.length), bytes]);
};
const signed = Buffer.concat([
	Buffer.from("SSHSIG"),
	field(namespace),
	field(""),
	field(hash),
	field(createHash(hash).update(message).digest()),
]);

const Capture = Schema.Struct({
	publicKey: Schema.String,
	authenticatorData: Schema.String,
	clientDataJSON: Schema.String,
	signature: Schema.String,
	flags: Schema.String,
	rpId: Schema.String,
	origin: Schema.String,
	challenge: Schema.String,
});

// ES256's DER sequence contains two positive INTEGERs, each at most 33 bytes.
const mpints = (der: Buffer): Buffer => {
	assert(der.length >= 8 && der.length <= 72 && der[0] === 0x30);
	assert.equal(der[1], der.length - 2);
	let at = 2;
	const integer = (): Buffer => {
		assert.equal(der[at++], 2);
		const length = der[at++];
		assert(length !== undefined && length >= 1 && length <= 33 && at + length <= der.length);
		const value = der.subarray(at, at + length);
		at += length;
		assert(value[0] !== undefined && value[0] < 0x80, "expected a positive DER INTEGER");
		assert(
			length === 1 || value[0] !== 0 || (value[1] !== undefined && value[1] >= 0x80),
			"expected a minimal DER INTEGER",
		);
		return field(length === 1 && value[0] === 0 ? Buffer.alloc(0) : value);
	};
	const result = Buffer.concat([integer(), integer()]);
	assert.equal(at, der.length);
	return result;
};

if (process.argv.length === 2) {
	console.log(signed.toString("hex"));
} else {
	assert(
		process.argv.length === 3 && process.argv[2] === "--pack",
		"usage: node experiments/230-passkey-sshsig.ts [--pack]",
	);
	const capture = Schema.decodeUnknownSync(Schema.fromJsonString(Capture))(
		readFileSync(new URL("./results/230-assertion.json", import.meta.url), "utf8"),
	);
	assert.deepEqual(Buffer.from(capture.challenge, "base64url"), signed);
	const point = Buffer.from(capture.publicKey, "base64url");
	assert(point.length === 65 && point[0] === 4, "expected an uncompressed P-256 public point");
	const auth = Buffer.from(capture.authenticatorData, "base64url");
	assert(auth.length >= 37);
	assert.deepEqual(Buffer.from(capture.flags, "base64url"), auth.subarray(32, 33));
	const key = Buffer.concat([
		field(keyAlgorithm),
		field("nistp256"),
		field(point),
		field(Buffer.from(capture.rpId, "base64url")),
	]);
	const signature = Buffer.concat([
		field(signatureAlgorithm),
		field(mpints(Buffer.from(capture.signature, "base64url"))),
		auth.subarray(32, 37),
		field(Buffer.from(capture.origin, "base64url")),
		field(Buffer.from(capture.clientDataJSON, "base64url")),
		field(auth.subarray(37)),
	]);
	const blob = Buffer.concat([
		Buffer.from("SSHSIG"),
		u32(1),
		field(key),
		field(namespace),
		field(""),
		field(hash),
		field(signature),
	]);
	const rows = blob.toString("base64").match(/.{1,70}/g) ?? [];
	console.log(`-----BEGIN SSH SIGNATURE-----\n${rows.join("\n")}\n-----END SSH SIGNATURE-----`);
}
