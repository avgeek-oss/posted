# Posted 0.2.0 release sign-off

Prepared on 18 October 2026 for the multi-post composer, per-account media and publishing workflow release. This report distinguishes local verification from publication and deployment. Release publication requires the exact source commit to pass Required CI and the image workflow below.

## Local evidence

- All 79 integration tests passed against disposable PostgreSQL schemas and private object-storage buckets. Coverage includes permission boundaries, OAuth/PKCE, MCP roles, draft versions and replay, sequence ordering/concurrent claims, failure propagation, account media inheritance and delivery selection.
- The documentation includes 24 fresh screenshots from an isolated sample installation: desktop light/dark, mobile account editing, thread composition, account customization, attachment inspection, schedule date/time and immediate publication confirmation. Sample history is fixture data; it is not proof of real provider publication.
- The release candidate uses one version, 0.2.0, for API, worker, UI and published-image Compose defaults. Existing Towbar manifests keep their previously published digests until the new immutable image manifest is available.

The complete local verification run passed documentation consistency, release contracts, formatting, lint, strict types, two operational tests, 79 PostgreSQL/storage integration tests, dependency audit and the production build. Mintlify build validation and broken-link checks passed; staged Gitleaks and workflow Actionlint checks reported no findings. Native ARM64 container installation/restore is checked locally. CI repeats these checks and adds native AMD64 installation/restore, CodeQL and source security scanning.

## Publication gates

1. Merge the reviewed PR after its Required CI succeeds. Confirm Required CI again for the resulting main commit.
2. Create `v0.2.0` on that exact commit and run **Publish release images** from main.
3. Require native AMD64/ARM64 image builds, security scans, platform-manifest validation and anonymous access to each immutable GHCR image.
4. Require installation and restore from the pulled images on both platforms. Publish the release with `posted-images.json` and matching Compose/environment assets only after those gates pass.
5. Update the repository's three Towbar service manifests from that published manifest, retaining manual deployment, workload IDs, placement, secrets, database and domains.

The GitHub release, Actions run and immutable manifest are the authority for publication status. Updating source or deployment manifests does not deploy the application. Provider approval, credentials, access plans and a separately authorized real-account publishing check remain operator prerequisites. Verification sends no real social posts.
