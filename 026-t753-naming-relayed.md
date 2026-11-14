FYI: the T753 naming correction ({ table, rev }, no ends map) is relayed to "Cloud lane: T753 L16 flake", and it was delivered.

- **The shape:** the saved table carries the one ledger `rev` it was folded through, since 0206 gives the ledger one global order.
- **On an ask:** fold the entries after `rev`; refold from 0 only on a rollback or a rewrite below `rev`.
- **Names:** every new name in the plan is checked against `.glossary/TERMS.md` before signing.
- **The plan:** amend and sign again if it is already signed.
