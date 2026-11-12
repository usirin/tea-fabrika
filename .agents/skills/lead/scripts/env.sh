# env.sh: shared paths for the lead's scripts. Sourced, never run. Every value can be set from outside.
#   MAIN    the main checkout, found from this script's own repo (a worktree finds its main checkout)
#   BOXES   where the boxes and saved plans live, beside the main checkout by default
#   REMOTE  the clone URL, read from the main checkout's origin
#   GH_REPO owner/name on GitHub, read from REMOTE
lead_here=$(cd "$(dirname "$0")" && pwd -P)
MAIN=${MAIN:-$(dirname "$(git -C "$lead_here" rev-parse --path-format=absolute --git-common-dir)")}
BOXES=${BOXES:-$(dirname "$MAIN")/boxes}
REMOTE=${REMOTE:-$(git -C "$MAIN" remote get-url origin)}
GH_REPO=${GH_REPO:-$(printf '%s\n' "$REMOTE" | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')}
# The person rides as Co-authored-by on the bot's commits.
FABRIKA_COAUTHOR=${FABRIKA_COAUTHOR:-"$(git config --global user.name) <$(git config --global user.email)>"}
# The model a box runs and its effort are settings (0069), not decisions: a person changes them in
# local.env beside the lead skill in the main checkout, which git ignores, with no pull request.
#   CODEX_MODEL=gpt-6.1-sol
#   CODEX_EFFORT=high
# The next step that starts reads it. fieldrow.py prices the model.
# shellcheck disable=SC1091
[ -f "$MAIN/.agents/skills/lead/local.env" ] && . "$MAIN/.agents/skills/lead/local.env"
CODEX_MODEL=${CODEX_MODEL:-gpt-6.1-sol}
CODEX_EFFORT=${CODEX_EFFORT:-high}
export MAIN BOXES REMOTE GH_REPO FABRIKA_COAUTHOR CODEX_MODEL CODEX_EFFORT
