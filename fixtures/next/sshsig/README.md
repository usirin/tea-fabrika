# SSHSIG vectors for `next/`

Saved signatures made once by real `ssh-keygen -Y sign` (OpenSSH), for the grant law p27 and the
signature shape law p44 in [the Tier 1 detail](../../../docs/plan/tier-1-detail.md#properties).
The first exam pull request (P1) holds them, so the owner reads them. `transport/sshsig.ts` (P7) is
checked against them.

The three keys are throwaway test keys, made for this and for nothing else. Their private halves
were deleted right after signing, so nobody can sign with them again. The namespace is
`fabrika-client`, the `space` in the detail's `checkSshsig` sketch.

| File | What it is | `checkSshsig` with `signer.pub` as the only signer |
|---|---|---|
| `text.txt` | The signed text, 2 lines, LF endings | |
| `changed.txt` | `text.txt` with one character changed (`p44` to `p45`) | |
| `signer.pub`, `other.pub` | Ed25519 public keys | |
| `ecdsa.pub` | An ECDSA P-256 public key | |
| `good.sig` | `signer` over `text.txt`, namespace `fabrika-client` | passes, signer `signer.pub` |
| `good.sig` over `changed.txt` | changed text | refused |
| `wrong-namespace.sig` | `signer` over `text.txt`, namespace `fabrika-other` | refused |
| `other-signer.sig` | `other` over `text.txt`, namespace `fabrika-client` | refused |
| `ecdsa.sig` | `ecdsa` over `text.txt`, namespace `fabrika-client`; good to OpenSSH | refused: Ed25519 only, even with `ecdsa.pub` named as a signer |
| `allowed_signers` | `signer` and `ecdsa`, for `ssh-keygen -Y verify` | |

p27 says the four refusals give the same answer. OpenSSH agrees with the table on all five rows,
except `ecdsa.sig`, which it accepts as a good ECDSA signature. That is the point of that vector.

How they were made, with `HOME` left alone and the keys in a temp folder:

```sh
ssh-keygen -q -t ed25519 -N "" -C "signer@fabrika.test" -f "$KEYS/signer"
ssh-keygen -q -t ed25519 -N "" -C "other@fabrika.test" -f "$KEYS/other"
ssh-keygen -q -t ecdsa -b 256 -N "" -C "ecdsa@fabrika.test" -f "$KEYS/ecdsa"
ssh-keygen -q -Y sign -f "$KEYS/signer" -n fabrika-client msg   # good.sig, msg = text.txt
ssh-keygen -q -Y sign -f "$KEYS/signer" -n fabrika-other msg    # wrong-namespace.sig
ssh-keygen -q -Y sign -f "$KEYS/other" -n fabrika-client msg    # other-signer.sig
ssh-keygen -q -Y sign -f "$KEYS/ecdsa" -n fabrika-client msg    # ecdsa.sig
rm -rf "$KEYS"
```

How to check them again:

```sh
ssh-keygen -Y verify -f allowed_signers -I signer@fabrika.test -n fabrika-client -s good.sig < text.txt
# Good "fabrika-client" signature for signer@fabrika.test with ED25519 key SHA256:...
```

Byte for byte matters here, so `.gitattributes` keeps LF endings on every checkout.
