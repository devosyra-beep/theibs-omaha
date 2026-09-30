# Hosting migration from the validated 0.14.10 release

## Current status

Frontend staging is deployed on Cloudflare, with Render still serving the API. No Oracle VM is provisioned and the backend/data migration is incomplete. Render must remain available until all cutover gates pass.

The in-app browser has an authenticated Cloudflare session. A separate account named `THEIBS` was created at the user's request, with free-tier defaults and without inheriting other accounts' payment methods or plans. Brandi and Osyra were not changed. The user connected `devosyra-beep/theibs-omaha` and created Worker `theibs-omaha` in that account. Its first build used `main`, root `/`, no build command and `npx wrangler deploy`, and failed before publishing because it could not detect static assets. After aligning the Wrangler name and correcting the provider branch, commands, root and four build variables, commit `2c47b99a6699e667e054b1d4a3dc3f510caf05a2` automatically produced successful build `956ad8ec-4c3d-419a-b7ae-e09063d78bc3` in 53 seconds. The provider settings persisted across reload. Authenticated gameplay, data portability, deployed cancellation and Oracle performance gates remain open. Oracle still requires user sign-in and its eligibility/capacity remain unverified.

The first successful provider build detected `PNPM_VERSION=11.19.0` but Corepack downloaded pnpm 11.24.0 because the package did not declare its package manager. The hosting package now explicitly pins `packageManager: pnpm@11.19.0`; verify the next provider log uses that exact version before claiming a fully reproducible build environment.

- Source baseline: `9ccbd33e29d1d8f5af19ba0c72c3160f10131bff`.
- Published runtime baseline: `9cac713297108d106fd4d3ee75cf99cb82035600`, version `0.14.10`.
- Existing mathematical and performance evidence: [river HU baseline report](river-hu-growth-0.14.10.md).
- Scope: hosting transport and deployment configuration. Solver, EV contracts, decision rules, voice parser, UI, Train and payment code are unchanged.

## Architecture

Cloudflare Worker Static Assets serves the existing public directory without rebuilding or changing its contents. `/` maps to `landing.html`; `/app` and `/app/` map to `index.html`. Existing relative asset paths, API paths and PWA URLs remain valid.

Only page aliases, `/api`, `/api/*` and `/healthz` run the gateway before static asset routing. Other assets use the asset service directly. Unversioned files retain `Cache-Control: no-store`. No authenticated response is cached. Request/response payloads, HTTP status codes and numerical provenance pass through without reinterpretation. The gateway checks the incoming browser Origin before translating it to the fixed backend Origin, retains bearer authentication, strips unneeded cookies/forwarding headers and refuses redirects. Its 60-second transport deadline does not change solver budgets or imply a three-second calculation guarantee.

The initial upstream is the existing HTTPS Render service. Switching it to Oracle is a separate, verified cutover. Oracle runs the unchanged Node API and worker threads. Cloudflare does not execute the numerical solver. No model weights are shipped to the browser and no remote LLM provider is enabled by this migration.

## Build and local verification

From `codigo-fonte/hosting/cloudflare`, with Node 22 or later:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm dev
```

The local gateway uses `http://localhost:4182`; the original app preview remains at `http://127.0.0.1:4179/app`. Gateway development still targets Render and consequently requires its real account/access policy. It does not disable authentication. The generated `.output/release-manifest.json` records byte hashes of every source asset. `.output` and credentials are ignored by Git.

Deploy with `pnpm run deploy` only after checking the Cloudflare account, project name, Free plan and exact release version. The explicit `run` is required because `pnpm deploy` is pnpm's workspace deployment command, not this package's script. Wrangler is pinned in an isolated development package; it is not a browser or backend runtime dependency. Static asset serving is free, while API gateway invocations consume Workers Free quotas. Monitor these quotas; never enable a paid upgrade automatically.

The dedicated Cloudflare account is `THEIBS`, ID `6cc5f0ca913765e16eff58df272659a1`. It was created with free-tier defaults and without inheriting payment methods, plans or entitlements. `wrangler.jsonc` binds publication to that account. Do not deploy into Brandi or Osyra.

For Workers Builds, select repository `devosyra-beep/theibs-omaha` and production branch `hosting/cloudflare-oracle-migration`, and set the root directory to `codigo-fonte/hosting/cloudflare`. Set `SKIP_DEPENDENCY_INSTALL=true`, `PNPM_VERSION=11.19.0`, `NODE_VERSION=24.19.0` and `WRANGLER_SEND_METRICS=false` as build variables. Use build command `pnpm install --frozen-lockfile --ignore-scripts && pnpm run build` and deploy command `pnpm run deploy`. Keep preview builds disabled initially. The build is a dry run and does not publish by itself. Verify the actual provider build settings and deployment result before declaring Git publishing connected. If watch paths are restricted, include `codigo-fonte/public/**` and `codigo-fonte/package.json` as well as the hosting directory.

Stop the local development process before rebuilding the generated assets on Windows; the runtime's directory watcher can prevent replacing its active output directory. `WRANGLER_SEND_METRICS=false` disables CLI telemetry for validation runs.

## Verification completed in preparation

| Evidence | Actual result | Scope |
| --- | --- | --- |
| Gateway and deployment unit checks | 15 passed, 0 failed | HARNESS: raw payload/status/provenance, origin rejection, bearer/header handling, redirects, deadline/cancellation before and after headers, hosted auth fail-closed |
| Existing action bounds, cache invalidation and independent precision checks | 62 passed, 0 failed | MODEL/HARNESS: unchanged mathematical implementation, including blocker/range/board/rake/stacks/sizing/version invalidation and third-action overlap |
| Independent sequence-form LP reference | 11 passed, 0 failed, 0 skipped | MODEL: existing separate SciPy environment; values, both saddle orientations, conditioned actions, incremental fees and exact Omaha showdown |
| Wrangler dry-run bundle | Passed | Build only; 70 application assets, 33,787,516 source bytes; no production upload |
| Public HTTP transport/asset smoke through local workerd to Render | 80 passed, 0 failed | HARNESS gateway with LIVE public upstream: page aliases, version 0.14.10, public config, unauthenticated API 401, cross-origin 403, missing asset 404 and SHA-256 parity of all 70 assets |
| Browser review | Desktop and 393×852 login rendered correctly | Browser via local gateway; Google sign-in was not completed, authenticated game interaction not executed |
| Independent source review | Initial redirect/cache/signal/lifetime findings corrected; no remaining source blocker reported | Review does not replace hosted runtime proof |

The first local run exposed that this workerd version rejects `redirect: 'error'`; the gateway now requests manual redirects and rejects every upstream 3xx response. Review also replaced `cf.cacheTtl: 0` with `cache: 'no-store'` and enabled `enable_request_signal`. Deadline/cancellation remains active while streaming the response body. These changes passed the repeated unit and 80 HTTP smokes.

**Open runtime check:** the dedicated client-disconnect probe in local Wrangler/workerd did not observe incoming cancellation propagating to its pending upstream, either before headers or with a hanging response body. This is a failed runtime gate, not a passed production cancellation test. The Node harness does demonstrate handling when the signal is delivered; the flag alone does not prove the deployed runtime will deliver it. Investigate the ingress/runtime behavior and repeat on the actual Cloudflare deployment before claiming client-disconnect propagation. Explicit state/job cancellation endpoints and stale-result validation remain unchanged, but their authenticated new-host smoke is also pending.

An independent test with the installed official Windows workerd executable, without Wrangler or Miniflare, reproduced the failure in all 18 stalled cases across pre-header, empty-body and initial-chunk responses with fetch abort, TCP close and TCP reset. Direct signal-property checks also remained false in all six real disconnect cases. Synthetic signals worked in both positive controls. When output was written every 100 ms, write failure let the production gateway abort the upstream in all six gateway cases, but incoming `Request.signal` still did not fire. This rules out Wrangler ingress as the sole explanation in the tested Windows setup; it does not isolate runtime core versus Windows sockets and does not establish production behavior. QA helpers were stopped and the original preview was preserved. The provider runtime cancellation gate remains open.

Reproduce the post-header probe in a fresh process, from the Cloudflare hosting directory:

```powershell
pnpm exec wrangler dev ../../test/helpers/cloudflare-runtime-probe.mjs --config wrangler.jsonc --port 4183
# In another terminal:
node probe-cancellation.cjs
```

Never deploy this QA entrypoint; it is separate from the production `worker.mjs`. The test waits for a confirmed upstream start before aborting and requires a delivered abort signal within its observation window, avoiding a false pass caused by the transport timeout.

No new-host solver p50/p95, cold/warm benchmark, VM memory measurement, account-wide backup, restore, reboot, real microphone or production functional claim is made by these results. The existing 0.14.10 baseline remains the only published performance evidence.

## Oracle preparation

Confirm the account's home region, available Always Free resources and total storage before provisioning. The currently documented A1 allowance is 2 OCPUs and 12 GB RAM in total, with 200 GB total block storage shared across the eligible resources. Actual allocation is subject to capacity. Do not provision a billable shape, extra block volume or paid load balancer as a fallback.

Use an approved ARM Ubuntu image and verify the runtime is Node 22 or later. Install the exact validated source revision under `/opt/theibs/releases/<commit>/codigo-fonte` and maintain `/opt/theibs/current` as the active release. The service templates intentionally do not provision infrastructure or start the server automatically.

Create a dedicated `theibs` system user and persistent directories owned by it:

```text
/var/lib/theibs/users
/var/lib/theibs/solver-cache
/var/lib/theibs/local
```

Install the reviewed service template as `/etc/systemd/system/theibs.service`. Populate `/etc/theibs/runtime.env` from `hosting/oracle/runtime.env.example`, root-owned with mode 0600. Configure the existing Supabase project, publishable/secret keys, access policy and any existing explicitly authorized optional integrations directly on the server. Do not print secrets, copy them to Cloudflare assets or commit the populated file.

The Node server binds to loopback only. A trusted HTTPS reverse proxy terminates TLS, using a controlled hostname or public IP with a valid publicly trusted certificate. A purchased domain is not needed for the Cloudflare `workers.dev` frontend, but a stable trusted HTTPS backend endpoint must be available before replacing Render. Do not use an ephemeral quick tunnel as permanent production, send bearer tokens to an HTTP IP address or disable TLS verification. Review firewall/SSH exposure against the actual VM configuration before starting it.

A possible domain-free backend is the VM's public IP with a Let's Encrypt IP certificate. IP certificates are generally available and valid for 160 hours; Certbot 5.4 or later supports IP webroot issuance. This option requires checking the actual Oracle IP allocation and zero-cost configuration, then proving automatic renewal and reverse-proxy reload before cutover. Certbot does not install IP certificates into the webserver automatically; use the reverse proxy's supported certificate/key configuration and protect private-key permissions. It is a documented option only, not a provisioned or validated endpoint. [Let's Encrypt availability](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability), [Certbot support and renewal requirements](https://letsencrypt.org/2026/03/11/shorter-certs-certbot).

Payments remain unconfigured. Storage persistence is required independently of billing; setting an environment flag alone does not prove persistence. Verify files survive a service restart and a VM reboot, and restore an actual backup into a clean test directory before cutover. Free-tier capacity and idle-instance reclamation remain operational limitations.

## Data inventory and migration gates

There are two distinct stores:

1. **Server files:** per-account `workspace.json` and `training-events.jsonl` under `.theibs-users` or `THEIBS_USER_DATA_ROOT`, account directories keyed by SHA-256 of the verified Supabase user ID. Copy complete files, revisions and backups into the persistent directory; do not recreate them from the recent-history overview. Preserve identities and revision conflict checks. Take a final consistent copy after pausing writes. Do not redeploy/restart the ephemeral Render source before preserving its data.
2. **Browser data:** player library chunks and manifests under `theibs.multiway.players.v2:<owner>`, legacy libraries, notes, archived hands and recorded decisions; voice and layout preferences. These are scoped to the browser origin and do not move merely because the backend moves. Inventory every relevant browser/profile; use a validated explicit export/import path and restore check before advertising a new origin as a complete migration. Never include auth sessions, tokens or transcripts in a portability file. No such portability UI is implemented by this hosting patch.

Render Free may not offer full shell/filesystem export. The current workspace endpoint is per-account; the history overview is truncated. If full export cannot be demonstrated, keep Render running and explicitly record which data remains unmigrated. A frontend-only deployment is not a completed backend/data migration.

## Cutover gates

All are required before suspending Render:

- Verify the approved Cloudflare and Oracle accounts and zero-cost resource configuration.
- Verify HTTPS end-to-end and exact `/app` route, asset manifest parity, public config and engine/interface version parity.
- Add the exact final `https://<frontend-host>/app` redirect URL to the existing Supabase project; preserve the old URL during rollback. Test Google sign-in, sign-out, access enforcement and expired-session handling. Avoid wildcard production redirects.
- Complete and restore-check the server and browser data inventory above; preserve all account ownership and revision checks.
- Reboot the VM and demonstrate persistent workspace/history restoration.
- Repeat mathematical smokes for separated and overlapping bounds, preserving current-profile EV, action-conditioned values and convergence as distinct quantities.
- Repeat cold/warm cache tests and every mathematically relevant invalidation, stale-job cancellation, progressive first response and final resolution measurements. Report p50/p95, bounds cost, memory, misses and hits against the 0.14.10 baseline. No precision relaxation or new coverage.
- Validate desktop/mobile routes, menus, keyboard, voice settings and active voice panel behavior in the browser. Human recognition and concurrent voice/EV tests must be labeled unexecuted if not actually run.
- Switch `API_UPSTREAM` to the verified Oracle HTTPS origin and repeat the same production smokes through Cloudflare.
- Keep a documented rollback until no migration gate remains. Preserve and restore any Oracle writes made after cutover before reverting traffic; pointing at an older ephemeral Render instance is not a complete rollback. Then reversibly suspend the old service; do not delete it or its data.

## References

- [Cloudflare selective Worker routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Cloudflare static asset billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
