# DGS production release

`Workers Builds: dgs` builds preview/staging, even when it is green on `main`. Production is the separate `dgs-production` Worker serving `www.digitalgrowthsociety.org`.

## One-time setup

1. Keep the protected `main` branch rules and independent approval. Review and squash-merge this workflow like any other change. Do not enable this workflow on PR branches.
2. Configure the GitHub Actions environment `production` for the exact `main` branch only. Do not add a second manual approval if automatic release after the PR approval is desired.
3. Add these **environment secrets**, using a dedicated Cloudflare token and the verified production Tina project (not preview credentials): `DGS_PRODUCTION_CLOUDFLARE_TOKEN`, `DGS_PRODUCTION_TINA_TOKEN`, `DGS_PRODUCTION_CLOUDINARY_API_KEY`, `DGS_PRODUCTION_CLOUDINARY_API_SECRET`. The Cloudflare credential needs Workers Scripts edit and the read permissions used to resolve the production zone, Worker, deployment, routes, DNS and custom firewall rules. Do not grant DNS/ruleset write access. Add environment variables `DGS_PRODUCTION_CLOUDINARY_CLOUD_NAME` and `DGS_PRODUCTION_CLOUDINARY_ROOT_FOLDER`.
4. Squash-merge an approved PR and look for **Deploy and verify DGS production** in GitHub Actions. A successful run publishes `dgs-production-proof`, with the active version, exact SHA, previous version and CA/US probe IDs. Verify `https://www.digitalgrowthsociety.org/release-sha.txt` matches the merge SHA.

## Release behavior

The job rejects an unassociated or non-current `main` commit, validates the protected PR and both required checks, builds using production Tina settings, and checks the uploaded version’s bindings before activation. It checks the homepage, sitemap-listed URLs, admin, metadata endpoints, changed public files and release marker over public TLS from Canada and the U.S. This is not a test of third-party websites, POST form submission or authenticated CMS writes. If verification fails after activation, the job attempts to restore the previous version, verifies the homepage, and fails the Actions run. Investigate a failed rollback immediately in Cloudflare; do not change WAF, DNS or staging to make probes pass.

For a non-mutating dry run on the current approved `main` checkout, use `--build-only` with the same environment. This builds and checks the release candidate and performs a public preflight, without uploading or activating a Worker.
