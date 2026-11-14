# DGS branded Pull Request preview gateway

This Cloudflare Worker exposes DGS branch previews through the professional client-facing hostname:

- `https://preview.digitalgrowthsociety.org/`

It keeps Cloudflare's account-level `workers.dev` hostname internal.

## Open a branch preview

Use a URL-encoded Git branch name once:

```text
https://preview.digitalgrowthsociety.org/?branch=feature%2Fclient-change
```

The gateway validates the branch name, stores it in a secure two-hour browser cookie, redirects to the clean branded URL, and proxies every route and asset to that branch's isolated Cloudflare Preview. The browser address bar and rewritten text responses do not expose the technical account subdomain.

To clear the selected branch and show stable staging again:

```text
https://preview.digitalgrowthsociety.org/?clear=1
```

Status endpoint:

```text
https://preview.digitalgrowthsociety.org/__preview/status
```

## Safety

- All responses receive `X-Robots-Tag: noindex, nofollow, noarchive`.
- `/robots.txt` remains disallow-all through the proxied site.
- Branch values are allowlisted to Git-safe characters and cannot select an arbitrary host.
- With no selected branch, the gateway shows `https://staging.digitalgrowthsociety.org/`.
- This Worker does not modify production DNS or the existing WordPress site.

## Test and deploy

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm run deploy:dry-run
corepack pnpm run deploy
```

Deployment requires a Cloudflare API token with Workers Scripts and Custom Domains permissions. Never commit or print that token.
