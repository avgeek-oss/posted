# Installation

Posted has separate API, worker and UI images with one version. Choose a release from the [GitHub Releases page](https://github.com/avgeek-oss/posted/releases) that includes `posted-images.json`. That file records immutable image references and both supported platforms, Linux AMD64 and ARM64. Use the version in that release for every component.

## Prerequisites

Use Docker Engine with Compose v2, PostgreSQL 17, separate HTTPS UI and API origins, and a reverse proxy with valid certificates. S3-compatible storage enables media and SMTP enables account emails. Social publishing requires approved provider applications. See [configuration](/configuration) before starting the installation.

Download `docker-compose.yml`, `posted.env.example` and, if needed, `docker-compose.postgres.yml` from the same release. Copy `posted.env.example` to `.env`. Set `POSTED_VERSION`, the public origins and a stable secret generated with:

```sh
openssl rand -hex 32
```

Keep `.env` private and retain `POSTED_SECRET` with the database backup. Changing it prevents encrypted provider tokens and sessions from being read.

## Start the containers

<Tabs>
  <Tab title="External PostgreSQL">
    Set `DATABASE_URL` to your PostgreSQL connection URI. The database must be reachable from the containers; `localhost` inside a container refers to that container.

```sh
docker compose pull
docker compose up -d
```

  </Tab>
  <Tab title="Bundled PostgreSQL">
    Set a random alphanumeric `POSTGRES_PASSWORD`. The overlay replaces the API/worker connection URI with the private Compose database and persists it in `posted-postgres`.

```sh
docker compose -f docker-compose.yml -f docker-compose.postgres.yml pull
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

  </Tab>
</Tabs>

The API applies transactional, checksum-checked migrations before readiness. The worker waits for the API. UI and API listen on loopback ports 4342 and 4341; route them through your HTTPS proxy. Keep the worker and PostgreSQL private.

## Create the team

Read the installation setup secret in the API's initial startup log:

```sh
docker compose logs api
```

Open the UI, enter that secret and create the first administrator. That administrator is verified automatically. Never share the log's setup secret in a support issue.

Verify all three containers are healthy:

```sh
docker compose ps
curl --fail http://localhost:4341/health/ready
curl --fail http://localhost:4342/health/ready
docker compose exec worker node -e "fetch('http://127.0.0.1:4343/health/ready').then(r=>{if(!r.ok)process.exit(1)})"
```

## Deploy with Towbar

The repository includes `towbar.yml`, three service manifests in `.towbar/services/`, and a PostgreSQL manifest in `.towbar/datastores/`. They use the published v0.1.0 image digests, run on the registered Platform Services server, and disable automatic deployment. Forks must update the server IP and public domains before connecting the repository.

1. Connect the repository in Towbar and map `production` to `main`.
2. Save the declared production runtime values in Towbar. Set `POSTGRES_USER=posted`, `POSTGRES_DB=posted` and a generated `POSTGRES_PASSWORD`. The API and worker share `DATABASE_URL` using host `posted-postgres:5432`, the same stable `POSTED_SECRET`, and the public `POSTED_WEB_URL`/`POSTED_API_URL`. Set `NODE_ENV=production` on all three services and configure the API's declared SMTP values. See [configuration](/configuration) for optional media storage and social-provider settings.
3. Deploy PostgreSQL, API, worker, then UI. The private `posted` Docker network connects the services to the database. Only API and UI have public domains.
4. Check the workload readiness probes, open the UI and complete administrator setup with the installation secret from the API startup log.

PostgreSQL data persists in a Towbar-managed volume. Back it up together with `POSTED_SECRET` before migration or recovery.

### Move an existing Towbar installation

Copying these manifests to another repository creates different Towbar workload identities; it does not transfer the existing volume, secrets or delivery history. Preserve the database and stable `POSTED_SECRET`, and coordinate the ownership cutover before connecting a replacement source. Removing the original manifests and syncing schedules cleanup of the old workloads and their owned storage. Keep the original source declarations until the migration has been verified.

## Build from source

A source checkout uses public npm dependencies with no registry token. Use Node 24.16.0 and pnpm 11.5.3 for development. The source-build overlay enables the Dockerfile's targets:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml build
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --no-build
```

Add the PostgreSQL overlay if needed. Every source-built image must use the checkout's package version. See [development](/development) for disposable test services and [upgrades](/upgrades) before replacing an installation.
