#!/bin/bash
# lane-seed.sh <T> <run> : a toy with a bare remote. $3 = extra files script
set -e
T=$1; R=$T/$2; mkdir -p $R/seed $R/home $R/logs $R/answers
git init --quiet --bare --initial-branch=main $R/remote.git
cd $R/seed && git init --quiet --initial-branch=main
cat > package.json <<'EOF'
{
  "name": "slug-lab",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {"node": ">=26"},
  "scripts": {"test": "vitest run", "typecheck": "tsc --noEmit"},
  "devDependencies": {
    "fast-check": "4.10.2",
    "typescript": "7.0.2",
    "vitest": "5.0.3"
  },
  "volta": {"node": "26.12.0"}
}
EOF
echo node_modules > .gitignore
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "es2024",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src"]
}
EOF
mkdir -p src .fabrika
cat > README.md <<'EOF'
# slug-lab

Small text helpers for a blog. Each helper is one file in `src/`, with its test beside it.

    npm ci
    npm test
    npm run typecheck
EOF
cat > AGENTS.md <<'EOF'
# Working here

- Each helper is one file in `src/`, with its test beside it as `name.test.ts`.
- No runtime dependencies. `fast-check` is there for property tests.
EOF
cat > src/title.ts <<'EOF'
/** A title with runs of whitespace closed up, and none at the ends. */
export function cleanTitle(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}
EOF
cat > src/title.test.ts <<'EOF'
import {expect, it} from "vitest";
import {cleanTitle} from "./title.ts";

it("closes up whitespace", () => {
	expect(cleanTitle("  a   b\n c ")).toBe("a b c");
});
EOF
cat > .fabrika/fabrika.toml <<EOF
[build]
install = ["npm", "ci", "--cache", "$T/npm-cache", "--prefer-offline", "--no-audit", "--no-fund"]
checks = [["node_modules/.bin/vitest", "run"], ["node_modules/.bin/tsc", "--noEmit"]]

[test_writer]
includes = ["**/*.test.ts"]
run = ["node_modules/.bin/vitest", "run", "--reporter=json", "--outputFile={out}"]
reads = []

[mutation]
tests = ["node_modules/.bin/vitest", "run"]
typecheck = ["node_modules/.bin/tsc", "--noEmit"]

[[checks.run]]
name = "test"
run = ["sh", "-c", "npm ci --cache $T/npm-cache --prefer-offline --no-audit --no-fund && node_modules/.bin/vitest run"]

[[checks.run]]
name = "typecheck"
run = ["sh", "-c", "npm ci --cache $T/npm-cache --prefer-offline --no-audit --no-fund && node_modules/.bin/tsc --noEmit"]
EOF
[ -n "$3" ] && . "$3"
env -u TYPESAFE_API_KEY npm install --package-lock-only --cache $T/npm-cache --no-audit --no-fund 2>&1 | tail -1
env -u TYPESAFE_API_KEY npm ci --cache $T/npm-cache --no-audit --no-fund 2>&1 | tail -1
node_modules/.bin/vitest run 2>&1 | tail -4; node_modules/.bin/tsc --noEmit && echo tsc ok; rm -rf node_modules
export GIT_AUTHOR_NAME=toy GIT_AUTHOR_EMAIL=toy@fabrika.invalid GIT_COMMITTER_NAME=toy GIT_COMMITTER_EMAIL=toy@fabrika.invalid
git add -A && git -c commit.gpgsign=false commit --quiet -m "first" && git remote add origin $R/remote.git && git push --quiet origin main && git log --oneline
echo "{\"repo\":\"toy/slug-lab\",\"remote\":\"$R/remote.git\",\"host\":\"local\"}" > $R/home/pipeline.json
