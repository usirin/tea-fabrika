FYI: the P18 move (head d25a79625) is relayed to "Cloud lane: desk (tezgah)", and it was delivered.

- **The merge:** it merges `fabrikalfa/p18-s1` at `d25a7962556e5e400d3b95dec0eee17a5fae30d5` into `fabrikalfa/cloud-desk-tezgah` before its tests step commits. It merges again if P18's review moves it. A merge commit, never a rebase or a force.
- **If it has no commits yet:** it starts the branch from the new head instead.
- **Its bases:** the `loosening.sh` and leak-check bases follow `origin/fabrikalfa/p18-s1` as it then stands.
