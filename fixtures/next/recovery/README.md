# P28 public recovery fixtures

These are public synthetic test keys for `next/`. Never use them for an account.
The zero-byte BIP39 answer is eleven `abandon` words then `about`.
The other answers are the BIP39 English increasing-byte and all-ones answers.
No private key is saved here. Temporary signing files are made from public seeds and deleted.

The tests step checked the v1 seed independently with Python HMAC extract/expand, Node HKDF,
and OpenSSL's Ed25519 public-key calculation. All three stored seed answers agreed.

| Entropy | v1 seed |
|---|---|
| `00000000000000000000000000000000` | `67f219d59a3125749c6a5f30516438911f80a061dcaec1193e40d1a8527365db` |
| `000102030405060708090a0b0c0d0e0f` | `66f1c08375d4551e4882bef84c23404c73b9cc127a4bee9658946d933c10fae9` |
| `ffffffffffffffffffffffffffffffff` | `24bf3cd13735ad234f0b43664d27a9dab9a15e49c4af2461850525feb60044cb` |

Run from the repository root. This exact command recreates `sshsig.json` with stock Node
and OpenSSH. Each signature is checked by `ssh-keygen -Y verify` before it is saved.
Its private-key files are only synthetic inputs to OpenSSH; do not read or print them.

```sh
env -u TYPESAFE_API_KEY node --input-type=module <<'JS'
import {createHash, createHmac, createPrivateKey, createPublicKey} from 'node:crypto';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const dir = mkdtempSync('/tmp/p28-vector.');
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const field = v => { const b = Buffer.from(v); return Buffer.concat([u32(b.length), b]); };
const hmac = (k, v) => createHmac('sha256', k).update(v).digest();
const derive = entropy => hmac(hmac(Buffer.alloc(32), entropy), Buffer.concat([Buffer.from('fabrika-recovery-v1'), Buffer.from([1])]));
const key = (seed, name) => {
  const privateKey = createPrivateKey({key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format:'der', type:'pkcs8'});
  const raw = createPublicKey(privateKey).export({format:'der', type:'spki'}).subarray(-32);
  const blob = Buffer.concat([field('ssh-ed25519'), field(raw)]);
  const body = Buffer.concat([u32(119120),u32(119120),field('ssh-ed25519'),field(raw),field(Buffer.concat([seed, raw])),field('public-test-only')]);
  const padding = Buffer.from(Array.from({length:8 - body.length % 8}, (_, i) => i + 1));
  const packed = Buffer.concat([Buffer.from('openssh-key-v1\0'),field('none'),field('none'),field(''),u32(1),field(blob),field(Buffer.concat([body,padding]))]);
  const path = `${dir}/${name}`;
  writeFileSync(path, `-----BEGIN OPENSSH PRIVATE KEY-----\n${packed.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`, {mode:0o600});
  return {path, line:`ssh-ed25519 ${blob.toString('base64')}`, raw:raw.toString('base64url')};
};
try {
  const vectors = [
    ['00000000000000000000000000000000', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'],
    ['000102030405060708090a0b0c0d0e0f', 'abandon amount liar amount expire adjust cage candy arch gather drum buyer'],
    ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
  ].map(([entropy, words], i) => {
    const seed = derive(Buffer.from(entropy,'hex'));
    const k = key(seed, `vector-${i}`);
    return {entropy, words:words.split(' '), seed:seed.toString('hex'), publicKey:k.line};
  });
  const recovery = key(derive(Buffer.alloc(16)), 'recovery');
  const person = key(Buffer.alloc(32, 1), 'person');
  const window = key(Buffer.alloc(32, 2), 'window');
  const agent = key(Buffer.alloc(32, 3), 'agent');
  const fresh = key(Buffer.alloc(32, 4), 'fresh');
  const freshWindow = key(Buffer.alloc(32, 5), 'fresh-window');
  const replaced = key(Buffer.alloc(32, 6), 'replacement');
  const to = 'p28', forPerson = 'person_01m6v5270hf3c8x2q7w9z4k5mn';
  const add = (id, adds, how, seen = null, drops = []) => ({id, for:forPerson, to, adds, drops, saw:{how,check:'touch',where:'test',has:[],typed:how==='sheet',kept:how==='sheet'?'print':null,old:how==='recovery'?'lost':null}, seen, sentAt:'2026-11-09T00:00:00.000Z'});
  const sheet = add('input_01m6v5270hf3c8x2q7w9z4k5m1', {_tag:'recovery',key:recovery.line,v:1}, 'sheet');
  const recover = add('input_01m6v5270hf3c8x2q7w9z4k5m2', {_tag:'person',key:fresh.line,window:freshWindow.raw}, 'recovery', 2, [person.line,window.raw]);
  const connection = 'connection_01m6v5270hf3c8x2q7w9z4k5mn', salt = Buffer.alloc(24,8).toString('base64url');
  const mac = createHmac('sha256',Buffer.alloc(32,7)).update(JSON.stringify([connection,0,salt])).digest('base64url');
  const preview = {to,url:'https://fabrika.test/entry/p28',connection,nonce:`0.${salt}.${mac}`};
  const sign = (name, signer, text, space='fabrika-client') => {
    const path = `${dir}/${name}.txt`;
    writeFileSync(path, text);
    execFileSync('ssh-keygen', ['-Y','sign','-f',signer.path,'-n',space,path], {stdio:'ignore'});
    const armored = readFileSync(`${path}.sig`,'utf8');
    const allowed = `${dir}/allowed`;
    writeFileSync(allowed, `fixture ${signer.line}\n`);
    execFileSync('ssh-keygen',['-Y','verify','-f',allowed,'-I','fixture','-n',space,'-s',`${path}.sig`], {input:text,stdio:['pipe','ignore','ignore']});
    return {name,signer:signer.line,text,armored};
  };
  const addedText = a => `${JSON.stringify({_tag:'added',add:a})}\n`;
  // One canonical JSON line. The preview schema and encoder must preserve this order.
  const previewText = `${JSON.stringify({_tag:'recovery_preview',...preview})}\n`;
  const grant = {id:'input_01m6v5270hf3c8x2q7w9z4k5m3',key:agent.raw,for:forPerson,to,as:'agent',saw:{code:'1234',label:'Test agent',where:'test',how:'command',check:'none',has:[]},sentAt:recover.sentAt};
  const signatures = [
    sign('sheet', person, addedText(sheet)),
    sign('recover', recovery, addedText(recover)),
    sign('window-add', window, addedText({...sheet,id:'input_01m6v5270hf3c8x2q7w9z4k5m6'})),
    sign('agent-add', agent, addedText({...sheet,id:'input_01m6v5270hf3c8x2q7w9z4k5m7'})),
    sign('recover-again', recovery, addedText({...recover,id:'input_01m6v5270hf3c8x2q7w9z4k5m9'})),
    sign('new-sheet', person, addedText({...sheet,id:'input_01m6v5270hf3c8x2q7w9z4k5ma',adds:{_tag:'recovery',key:replaced.line,v:1}})),
    sign('recovery-sheet', recovery, addedText({...sheet,id:'input_01m6v5270hf3c8x2q7w9z4k5m4',adds:{_tag:'recovery',key:replaced.line,v:1}})),
    sign('recovery-grant', recovery, `${JSON.stringify({_tag:'granted',grant})}\n`),
    sign('foreign-drop', person, addedText({...sheet,id:'input_01m6v5270hf3c8x2q7w9z4k5m5',drops:['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKV3z6pcdT9LaC5yvJXiPl11GORduEe1bcZLJxZxSzCF']})),
    sign('other-ledger', recovery, addedText({...recover,to:'other'})),
    sign('preview', recovery, previewText),
    sign('wrong-namespace', recovery, previewText, 'elsewhere'),
  ];
  const labelCollisions = [], seen = new Map(['blob-hex','blob-base64','raw-hex','raw-base64'].map(kind => [kind,new Map()]));
  for (let n=0; n<50000 && labelCollisions.length<4; n++) {
    const entropy=Buffer.alloc(16); entropy.writeUInt32BE(n,12);
    const seed=derive(entropy), privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
    const raw=createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32), blob=Buffer.concat([field('ssh-ed25519'),field(raw)]);
    const answer={entropy:entropy.toString('hex'),key:'ssh-ed25519 '+blob.toString('base64')};
    for (const [kind, candidates] of seen) {
      if (labelCollisions.some(pair => pair.kind===kind)) continue;
      const prefix=createHash('sha256').update(kind.startsWith('blob')?blob:raw).digest(kind.endsWith('hex')?'hex':'base64').slice(0,4);
      const before=candidates.get(prefix);
      if (before) labelCollisions.push({kind,prefix,a:before,b:answer}); else candidates.set(prefix,answer);
    }
  }
  if (labelCollisions.length!==4) throw new Error('bounded public-label vector search exhausted');
  writeFileSync('fixtures/next/recovery/sshsig.json', JSON.stringify({format:1,warning:'PUBLIC SYNTHETIC TEST DATA. Never fund or use these keys.',vectors,labelCollisions,keys:{person:person.line,window:window.raw,windowLine:window.line,agent:agent.raw,agentLine:agent.line,recovery:recovery.line,fresh:fresh.line,freshWindow:freshWindow.raw,replacement:replaced.line},preview,signatures},null,2)+'\n');
  console.log('Three HKDF/BIP39 vectors; twelve OpenSSH signatures independently verified.');
} finally { rmSync(dir,{recursive:true,force:true}); }
JS
```

Independent seed and public-key check. Expected first public key:
`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIG7cbo1iOLrhS+KMPO3qI4eOHyN8lSkmiscOpPQmKgs`.
This passes private bytes to OpenSSL on stdin and prints only a public key. It reads no key file.

```sh
python3 - <<'PY'
import base64, hashlib, hmac, struct, subprocess
for entropy in (bytes(16), bytes(range(16)), bytes([255])*16):
    prk = hmac.new(bytes(32), entropy, hashlib.sha256).digest()
    seed = hmac.new(prk, b'fabrika-recovery-v1'+bytes([1]), hashlib.sha256).digest()
    der = bytes.fromhex('302e020100300506032b657004220420') + seed
    public = subprocess.run(['openssl','pkey','-inform','DER','-pubout','-outform','DER'], input=der, check=True, capture_output=True).stdout[-32:]
    field = lambda b: struct.pack('>I',len(b)) + b
    print(entropy.hex(), seed.hex(), 'ssh-ed25519 '+base64.b64encode(field(b'ssh-ed25519')+field(public)).decode())
PY
```

The preview nonce uses the existing door nonce format. Its public fixture HMAC key is 32 bytes
of `07`, its salt is 24 bytes of `08`, and the test clock is zero. It is bound to the saved
connection. Only this disposable vector world installs that test nonce key.

The signature text is one canonical JSON line with a trailing LF. Recovery adds sign `add.seen`.
The preview text is a test contract for the pending P28 encoder, not an existing transport format.

## Running the laws

All generated laws use Effect Schema, `Arbitrary.schema`, and `it.prop` or `it.effect.prop`.
They run 100 cases, size 32, seed 119120. No handwritten fast-check is used.
Tea reducer laws use `foldEvents` and `lawInvariant` from `@demlik/tea/pbt`.
Failure positions and confirmation positions are dependent, bounded values.

Use `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false PNPM_CONFIG_OFFLINE=true` for this exam-only catalog
change. Otherwise pnpm 12 tries to install before a script. These are process settings only.

```sh
env -u TYPESAFE_API_KEY PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false PNPM_CONFIG_OFFLINE=true pnpm exec vitest run --maxWorkers=1 next/packages/libfabrika/src/desktop/sheet.test.ts next/packages/libfabrika/src/desktop/sheet-key.test.ts next/packages/libfabrika/src/desktop/recovery.test.ts next/packages/libfabrika/src/coordination/sheet-check.test.ts next/packages/libfabrika/src/coordination/p28.test.ts next/packages/libfabrika/src/door/sheet.test.ts next/packages/libfabrika/src/transport/recovery.test.ts
```

`P28_PLANT` selects a named mutation of an observation from real code. These are assertion checks,
not a claim that a missing implementation has been mutation-tested. The scanner's own plants
run independently; the full-flow law must also run before the lead can mark secrets green.
The full-flow law has a plant for each individual word, phrase, entropy and seed in each output,
including encoded forms and nested span content. No missing implementation is skipped.

## Tests-step result, 2026-11-09

This report is for `next/`, based on main `a77d14c3` plus the approved recovery-note changes.
The seven-file exam ran 55 tests: 21 passed, 34 failed, none skipped. Failures are separated
below. Missing exports are pending product work, not a successful plant check.
Paths in this table are relative to `next/packages/libfabrika/src/`, except the two marked rows.

| Law | File:line | Result and reason |
|---|---|---|
| 1 | `desktop/sheet.test.ts:116`, `desktop/sheet-key.test.ts:18` | Missing P28 words, derivation and scoped-key exports. The independent derivation control passes. |
| 2 | `desktop/sheet.test.ts:155` | Missing P28 checksum and label-check exports. |
| 3 | `desktop/sheet.test.ts:198` and collision vector `:86` | Missing P28 cached-check exports. Four saved short-label collisions came from an independent bounded search. |
| 4 | `desktop/recovery.test.ts:93`, `:136`, `:279` | Missing P28 handlers/reducer; the separate PersonCheck law needs upstream P21. |
| 5 | `desktop/recovery.test.ts:167`, `desktop/sheet-key.test.ts:48` | Missing P28 draft cleanup and scoped-key exports. |
| 6 | `desktop/recovery.test.ts:196`, `door/sheet.test.ts:648` | Missing P28 reducer; real-door lost and kept integration passes. |
| 7 | `coordination/p28.test.ts:123`, `door/sheet.test.ts:450` | Pass: first founding and old note rows/authors survive. |
| 8 | `coordination/p28.test.ts:140` | Pass: permanent drops and every ancestor checked. |
| 9 | `coordination/p28.test.ts:173` | Pass: equal device and sheet roots. |
| 10 | `coordination/p28.test.ts:196`, `door/sheet.test.ts:492` | Pass: replacement, one use, real competing appends and stable retries. |
| 11 | `coordination/p28.test.ts:226`, `door/sheet.test.ts:1467` | Pass, including real UV WebAuthn proofs and valid backup flags. |
| 12 | `coordination/p28.test.ts:261`, `door/sheet.test.ts:594`, `:619`, `:634` | Behavior on main: foreign drops are accepted; valid unknown proofs become bad_signature. Wrong-target refusal passes. |
| 13 | `door/sheet.test.ts:678` | Missing P28 authenticated preview exports. |
| 14 | `door/sheet.test.ts:699` | Missing P28 byte-identical preview refusal. |
| 15 | `door/sheet.test.ts:783` | Missing P28 preview nonce consumption/binding/lifetime. |
| 16 | `door/sheet.test.ts:811`, `:831`, `:1015` | Behavior on main: addText drops signed seen, tampering is accepted, missing/stale seen is accepted. Snapshots assert no writes or spending on refusal. |
| 17 | `door/sheet.test.ts:942` | Behavior on main: unsigned seen can be raised after signing. After a new sheet, B's re-read gets the shared refusal. No writes/spending is required for both tampered and stale requests. |
| 18 | `coordination/sheet-check.test.ts:51`, `desktop/recovery.test.ts:337`, `door/sheet.test.ts:1141` | Missing P28 signed-check encoder, retry queue and door method. |
| 19 | `door/sheet.test.ts:1195` | Main's close-4003 and removed-write assertions pass; the law then fails on missing P28 removalCounts. |
| 20 | `desktop/recovery.test.ts:230` | Missing P28 reducer/view/handlers. Tea replay itself is the installed real implementation. |
| 21 | `door/sheet.test.ts:1746`, scanner control `:2025` | Full generated flow: missing P28 exports. Independent scanner controls pass with a clean control and every token/form planted in each output. |
| 22 | `desktop/sheet-key.test.ts:80` | Missing P28 public/model schemas and secret holder. |
| 23 | repo `.oxlintrc.json:347`, `layer-rules.json:44`, `boundary-rules.json:20` | Rules/exam checks pass except the required Tuval boundary: upstream has no Tuval package root yet. |
| 24 | `desktop/sheet.test.ts:237` | Missing P28 derivation exports. Three independent HMAC/HKDF/OpenSSL answers agree. |
| 25 | `transport/recovery.test.ts:19`, `:29`, `door/sheet.test.ts:1375`, `:1394`, `:1442` | Independent crypto and allowed/forbidden real-door vectors pass except foreign-drop/signed-seen behavior. Candidate signer reader is a missing P28 export. |
| 26 | `door/sheet.test.ts:531`, `:1454` | Missing P28 preview encoder and method; OpenSSH independently verified the stored signature. |
| 27 | repo `next/apps/fabrika/e2e/recovery.test.ts:22` | Written, not run: missing upstream P19/P21/P26 plus sandbox window/socket limits. |
| 28 | repo `next/apps/fabrika/e2e/recovery.test.ts:134` | Written, not run: requires a person, real print and Touch ID outside this sandbox. |

## Plant results

All ten runnable observation plants below failed their own law with an assertion failure.
The unchanged laws passed first. These are test sensitivity checks, not product source mutations.

| P28_PLANT | Law and observed failure |
|---|---|
| `replace-founded` | L7: changed founding no longer equals the first founding. |
| `rewrite-authors` | L7: changed real saved note row no longer equals the old row. |
| `revive-dropped` | L8: a dropped key becomes live. |
| `own-live-only` | L8: a child under a dropped ancestor gets admission. |
| `device-under-device` | L9: another root is attached beneath a device. |
| `sheet-under-device` | L9: the sheet is attached beneath a device. |
| `skip-replaced` | L10: two sheets stay live. |
| `skip-spent` | L10: a used sheet gets admission. |
| `loser-applied` | L10: the losing real append is reported as applied. |
| `window-authority` | L11: a window receives person authority. |

The generated L21 scanner control planted every word separately, the full phrase, entropy and
seed, in raw/JSON/URL/hex/base64/base64url forms, into frames, ledger, logs and spans/content.
Every leak was detected; the nonempty clean outputs passed. Full-flow plants remain blocked
on P28 and must not be counted as caught. All other plants behind missing exports are pending.

The command for an observation plant is the narrow law command above, adding
`P28_PLANT=<name>` to its environment and `-t '<law name>'` to select the matching test.
No missing-import failure was counted as a caught plant.

## Check results

The existing six narrow membership, client, passkey, transport and revocation files passed
118 tests. The four existing tag/Promise/edge/layer exam files also passed all 19 tests.
No full suite ran. `pnpm lint` ran once; its upward test imports were fixed by moving integration
laws into the door/desktop files. Targeted layer, browser, dead-code, compiler, token and CSS
checks then passed. Boundary checking still fails on the absent upstream Tuval package root.
`pnpm typecheck` ran once: pending P28 modules, Add.seen, door methods and their resulting
unknown types remain red. Two independent fixture typing errors were fixed after that run.
The catalog's new dependencies are intentionally not installed: build owns package.json/lockfile.

Before the offline process settings were found, pnpm tried its automatic dependency refresh;
registry DNS was denied. Installed dependencies were restored from a local dependency copy.
No registry access succeeded, no real key or paid service was used, and no push was made.

## Outside run and pending handoffs

`next/apps/fabrika/e2e/recovery.test.ts` has both outside scenarios. The support uses short
`/tmp/fh.*` homes, a disposable stage, a test printer and test PersonCheck. Never set
`FABRIKA_FOREGROUND=1`. Keep `TYPESAFE_API_KEY` unset. Run only that file through the e2e runner.
P19/P21/P26 are unbuilt. Their entry paths, test adapter connection and accessible UI names must
be reconciled by tests before build. The planned stage readiness and test inspection routes are
asserted contracts, not implementations or mocked successes. They need the lead's upstream check.

The lead must see all nine Electron steps pass, kept recovery and UV passkeys pass their properties,
and every key state at full, side-by-side, stacked, grid and 1024x700 sizes. Inspect every picture.
A person must use real Touch ID, physical print and a second disposable home. L28 requires their
outside evidence and rejects the test printer/PersonCheck. VoiceOver is a separate outside check.
The failed-unseal scenario compares only the disposable sealed files' names, size and modification
time. It never opens a key file, and must find those files before asserting they stay unchanged.

## Law 17 sheet re-read

After the old Mac makes a new sheet, law 17 requires B's `added` to get `stale` without a write
or spend. The new sheet replaces B's sheet under call 6. B's re-read with its original sheet
gets call 13's shared refusal and writes nothing. After a device is added, B's re-read still
lists the new key, and a `lost` recovery from that list drops it.

These tests cannot prove physical printing, Touch ID, VoiceOver, deployed cloud state, or memory
erasure. Those remain outside checks. Missing exports and sandbox limits are never passes.

