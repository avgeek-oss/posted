# Posted 0.2.0 release sign-off

Published on 18 October 2026 (Asia/Kolkata) for the multi-post composer, per-account media and publishing workflows. [Posted v0.2.0](https://github.com/avgeek-oss/posted/releases/tag/v0.2.0) contains the immutable image manifest and matching Compose/environment assets.

## Source and documentation

[PR #3](https://github.com/avgeek-oss/posted/pull/3) merged as `48e2683b96b0a829da9ad96df464b56433da7890`. The annotated `v0.2.0` tag points to that commit. [Exact-commit main CI](https://github.com/avgeek-oss/posted/actions/runs/39067683174) passed verification, documentation, security, CodeQL and native AMD64/ARM64 production installation and restoration.

The documentation includes 24 fresh screenshots from an isolated sample installation: desktop light/dark, mobile account editing, thread composition, account customization, attachment inspection, schedule date/time and immediate publication confirmation. The published [composer guide](https://www.posted.cc/composer) was reviewed with its deployed screenshot. Sample history is fixture data; it is not evidence of real provider publication.

## Verification

All 79 integration tests passed against disposable PostgreSQL schemas and private object-storage buckets. Coverage includes permission boundaries, OAuth/PKCE, MCP roles, draft versions and replay, sequence ordering/concurrent claims, failure propagation, account media inheritance and delivery selection.

The complete local verification run passed documentation consistency, release contracts, formatting, lint, strict types, two operational tests, 79 PostgreSQL/storage integration tests, dependency audit and the production build. Mintlify build validation and broken-link checks passed; staged Gitleaks and workflow Actionlint checks reported no findings. Native ARM64 container installation/restore passed locally.

## Published images

[Release run 39068006597](https://github.com/avgeek-oss/posted/actions/runs/39068006597) completed successfully. It built API, worker and UI on native AMD64 and ARM64, scanned all six images with no HIGH/CRITICAL findings, validated their source/version labels and aliases, and verified anonymous registry access. Installation and restoration from the pulled immutable images passed on both platforms before publication.

The public [posted-images.json](https://github.com/avgeek-oss/posted/releases/download/v0.2.0/posted-images.json) records version `v0.2.0`, source commit `48e2683b96b0a829da9ad96df464b56433da7890` and both supported platforms. Its SHA-256 is `d0b91d93ea05b779ad2a59a3cbc4b2591415b93ce9fc01663ad35867e7022a77`. Independent anonymous inspection confirmed all three immutable image indexes contain AMD64 and ARM64.

## Towbar deployment handoff

The repository's three Towbar service manifests use the published v0.2.0 digests. Only image references and version descriptions change; manual deployment, workload IDs, placement, runtime secrets, datastore and domains are retained. See [installation](installation.md) and [upgrades](upgrades.md) for backup and deployment order.

This release and manifest update prepare the installation for deployment. They do not deploy the live application. Provider approval, credentials, access plans and a separately authorized real-account publishing check remain operator prerequisites. Verification sent no real social posts.
