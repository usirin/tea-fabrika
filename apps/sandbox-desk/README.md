# Host the desk in a private Sandbox

This hosts the experimental [browser desk](../browser-desk/README.md). The
default Electron app and its host remain separate. The historical hosted
proof was made on the earlier library revision recorded in experiment 131;
publishing this source does not redeploy that instance.

This runbook deploys the same Fabrika host used by the local GUI. A Worker
verifies Cloudflare Access, selects the owner's Durable Object, and forwards
the browser connection to that object's Linux Sandbox. Use it for a private
trial. Keep the existing desk while checking the new route.

## Prepare

Use Node 26, pnpm, Docker, and an authenticated Wrangler profile for the
target account. The hostname must already have an Access application covering
`/fabrika/*`, with the two approved email identities. This package does not
create an Access policy or change the existing application.

Create a private target file outside the checkout:

```json
{
  "account": "<32 hex account ID>",
  "zone": "<32 hex zone ID>",
  "origin": "https://desk.example.org",
  "issuer": "https://team.cloudflareaccess.com",
  "audience": "<the existing Access application audience>",
  "emails": ["one@example.org", "two@example.org"]
}
```

Build both parts and generate the private deployment folder:

```sh
pnpm install --frozen-lockfile
pnpm --filter @tea-fabrika/gui build
pnpm --filter @tea-fabrika/gui-cloud build
cd apps/sandbox-desk
node prepare.ts <private-target.json>
```

The command prints a folder, Worker name and address. Keep that folder. It
holds `wrangler.json`, `secrets.json`, and `connection.json`. The owner map
must stay stable across deploys. Re-running preparation creates different
desks, not an upgrade of the existing ones.

## Deploy and check

Use the printed Worker name for the new R2 bucket. Use the printed private
folder for both configuration and secrets. Name the profile explicitly:
Wrangler may otherwise select its default profile from the configuration's
folder.

```sh
pnpm exec wrangler r2 bucket create <worker-name> --profile <profile>
pnpm exec wrangler deploy --dry-run --config <folder>/wrangler.json --profile <profile>
pnpm exec wrangler deploy --config <folder>/wrangler.json --secrets-file <folder>/secrets.json --profile <profile>
```

The Dockerfile builds a Node Linux image with the pinned Sandbox shim and
native PTY package. A named image's `build_vars.FABRIKA_BASE_IMAGE` can reuse
an existing trusted image with development tools installed. Rebuild the GUI
and cloud package before rebuilding an image.

Open the printed `/fabrika/` address and sign in through Access. Type `terminal`
in tsh, then `uname -s`. It must print `Linux`. Type `counter` in another pane
and run its five-step job. Disconnect the view and reconnect; the job must
continue. No agent or provider account is needed for these checks.

Create a file in the terminal, then choose **Save and sleep**. Wait for the
save to finish before choosing **Reconnect**. The saved pane, file and counter
state must return from R2 in a replacement Sandbox. Terminal processes and
scrollback restart. Saving is not a process checkpoint.

Each owner has an independent `/desk` directory and backup prefix. The
Worker selects both from the verified email. A browser cannot request another
owner. The image carries no user login; sign in to tools inside the new
workspace. To use two Claude configurations in one workspace, select separate
`CLAUDE_CONFIG_DIR` directories under `/desk/home`, using the native CLI's
own login flow. Existing cloud profiles are not migrated by deployment.

## Operating the trial

Use **Save workspace** to keep files and durable program state in R2, then
restart the programs. Use **Save and sleep** before leaving to stop billing
the instance. A failed save retains the last complete reference and reopens
the live disk. A failed restore does not silently create an empty workspace.
If opening fails, reload the desk and use **Retry saved desk**. That explicit
recovery restores the last complete save; newer unsaved changes may be replaced.

This trial saves and sleeps after every browser has been disconnected for
30 minutes; counter jobs keep it awake. An arbitrary shell command does not
extend that window and may be stopped. Keep a view connected for long shell
work. A platform failure before the next successful save can lose intervening
file changes.

The initial instance has 1 vCPU, 2 GiB memory and 8 GB disk. The two approved
owner IDs select at most two instances. Closing the page is not an immediate
stop. Running instances incur memory/disk charges, active CPU charges, and
Worker/Durable Object usage. R2 and network usage are additional. See the
[current Containers rates](https://developers.cloudflare.com/containers/platform/pricing/).

The gateway stops the Fabrika host and its descendant shell processes before
reading `/desk`. Independently reparented daemons are outside this trial's
process ownership. Do not use such processes as workspace writers during a
save. User home and files are included in private backups, which can contain
tool credentials; keep the bucket private.

For the observed evidence and limits, read
[experiment 131](../../experiments/131-ghostty-sandbox-desk.md).
