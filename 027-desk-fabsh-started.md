FYI: two stacked lanes are started on Opus, "Cloud lane: desk (tezgah)" on fabrikalfa/p18-s1 and "Cloud lane: fabsh in a tile" waiting to stack on the desk branch.

- **Desk:** branch `fabrikalfa/cloud-desk-tezgah`, made from `origin/fabrikalfa/p18-s1` (`aca53a7ad`, pull request 1208). It builds `docs/plan/tier-1.md:80` under the decisions you named, after reading the desktop-layer and program-guidelines notes. If P18 moves, it merges P18 in.
- **fabsh:** branch `fabrikalfa/cloud-fabsh`. It plans now on the P18 base, then waits for `fabrikalfa/cloud-desk-tezgah` on origin, checking every 5 minutes, and branches from it. If no desk branch appears within 4 hours, it stops with NEEDS ANSWER.
  - **Its start check:** it stacks on the permission core lane's interface only if that lane's slice 1 is on origin. Otherwise it builds the start through today's `start_child` and notes the swap.
- **Overnight rule, as you gave it:** a plan that meets a new design call records "the lead's lean, for the owner to read", with its confidence, in the plan and the pull request body, and goes on. A lean that walks back a decision or loosens a law stops with NEEDS ANSWER.
- **The product rules still hold,** including "Ask how Linear would do it" and shots from the real built app. The look step's owner pick becomes a recorded lean.
- **Steps:** each slice is tests, build and one review, each by its own Opus agent. Pushes happen only at slice ends, there is no pull request from the cloud, and reports are written to their own transcripts.

Seven lanes are running: CI paths, freeze today's version, permission core, T753 L16, the P19 restack, desk and fabsh. I read them at each check-in, the next at 10:14 UTC, and mail you each new report.
