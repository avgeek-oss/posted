# Posted 0.1.0 release sign-off

Reviewed on 14 October 2026. **Local candidate preparation is signed off. Public release approval remains pending the publication gates below.** No repository publication, application release, deployment or real social post was performed.

## Verified local gates

| Gate                                                 | Evidence                                                                                                                         | Result                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Source formatting, lint and strict types             | Final `pnpm verify`                                                                                                              | Passed                                          |
| Database, storage, OAuth, MCP and provider contracts | 67 application tests, zero failures or skips                                                                                     | Passed                                          |
| Release integrity                                    | Immutable three-image manifest and latest exact-commit CI tests                                                                  | 2 tests passed                                  |
| Dependency vulnerabilities                           | Full production and development `pnpm audit`; peer dependency check                                                              | Zero advisories or peer issues                  |
| Source credentials                                   | Gitleaks 8.30.1 redacted scan and Trivy source scan                                                                              | No leaks found                                  |
| Source security                                      | Trivy 0.75.0, HIGH/CRITICAL vulnerabilities and secrets                                                                          | Zero findings                                   |
| Runtime image security                               | Fresh API, worker and UI image scans, HIGH/CRITICAL                                                                              | Zero findings in all three                      |
| ARM64 installation                                   | Fresh production images; five combined installation gates                                                                        | Passed                                          |
| Branded account email                                | Disposable Mailpit in production installation gate                                                                               | Passed; first admin sends no verification email |
| Recovery                                             | Database and private media restored into a second disposable installation                                                        | Passed                                          |
| Runtime boundaries                                   | UID 1000, read-only root, dropped capabilities, private worker, exact-origin CORS and protected deep routes                      | Passed                                          |
| Compose                                              | Published-image, bundled PostgreSQL and source-build configurations; no registry credentials                                     | All three validate                              |
| Mintlify                                             | Shared kit consistency, 24 navigation routes, 19 REST/MCP schemas, native build validation and broken-link check                 | Passed                                          |
| Responsive documentation                             | Rendered desktop/mobile light/dark, installation tabs, guide navigation and 12 sample screenshot assets                          | Passed                                          |
| Workflow syntax                                      | Pinned actions, `actionlint` and release version validation                                                                      | Passed                                          |
| Fixture cleanup                                      | Owned documentation schema and private bucket removed; production test containers, network, environment and restore dump removed | Passed                                          |

The local production evidence and sanitized scan reports are in `artifacts/release-readiness/`. Documentation is previewable with `pnpm docs:dev` at `http://localhost:4177`. The prepared site uses the shared Mintlify kit, Posted branding and sample data, with product guides, configuration, provider setup, security, operations, upgrades and backup/recovery.

## Unresolved release gates

### Native AMD64 and exact-commit CI

Local AMD64 emulation on this ARM Mac failed twice during dependency installation with the same Node/libuv assertion: `errno == EEXIST` in `uv__io_poll`. It is recorded as a failed verification attempt, not a passing platform check. The cause has not been established. Native Linux AMD64 and ARM64 installation/restore jobs are prepared in CI and are mandatory before publication. Local ARM64 proof does not substitute for native AMD64 proof.

The checkout has no initial commit or Git remote, and `avgeek-oss/posted` was not found during repository verification. GitHub Actions, CodeQL and branch protection have therefore not been exercised for this candidate. The release workflow requires the latest **Required CI** success for the exact source commit; it cannot accept an earlier success after a later failure.

### Public artifacts and hosted documentation

`https://posted.cc` redirects to `https://www.posted.cc` and currently displays the Mintlify starter kit. The prepared Posted documentation has been validated locally but is not deployed there.

The three GHCR packages and GitHub release are not published. Anonymous pulls, immutable platform manifests, SBOM/provenance and release asset verification run in the prepared publication workflow after the repository and packages exist. Installation instructions apply to a published release containing `posted-images.json`; they do not assert that 0.1.0 is already available.

## Publication sequence

1. Publish the reviewed source to the intended repository with `main` as the release branch.
2. Require **Required CI**, covering source/tests, documentation, security/CodeQL and native AMD64/ARM64 production verification, on the exact release commit.
3. Enable private vulnerability reporting and connect Mintlify to the repository's `docs` directory. Verify the production site after deployment finishes.
4. Create `v0.1.0` on that verified commit and run **Publish release images** from `main`.
5. Make all three GHCR packages public. The workflow refuses release publication until anonymous immutable-image inspection succeeds.
6. Let the workflow scan all platform images, validate both platforms and aliases, verify installation/restore from pulled images, and attach `posted-images.json` with matching Compose/environment assets before publishing the GitHub release.

Provider application approvals, production credentials and a separately authorized real-account publishing smoke test remain operator acceptance gates. Contract tests exercise real provider request shapes through strict local transports; they do not establish provider approval, quota availability or real publication. Account email verification sends only to local Mailpit. The existing preview installation and its content were retained.
