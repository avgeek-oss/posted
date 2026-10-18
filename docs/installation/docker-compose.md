# Docker Compose

Install Posted with Docker Compose. The steps below include PostgreSQL, so you do not need to set up a separate database.

## Before you start

You need Docker with Compose v2 and two HTTPS domains: one for Posted and one for its API. A reverse proxy routes those domains to the containers.

## 1. Download the installation files

Create a directory and download the files from the latest [GitHub release](https://github.com/avgeek-oss/posted/releases):

```sh
mkdir posted
cd posted
curl -fLO https://github.com/avgeek-oss/posted/releases/latest/download/docker-compose.yml
curl -fLO https://github.com/avgeek-oss/posted/releases/latest/download/docker-compose.postgres.yml
curl -fLO https://github.com/avgeek-oss/posted/releases/latest/download/posted.env.example
cp posted.env.example .env
chmod 600 .env
```

To install a specific release, download these three files from that release instead. Published images support Linux AMD64 and ARM64.

## 2. Set your domains and secrets

Open `.env` and change these four values:

| Setting             | What to enter                                                         |
| ------------------- | --------------------------------------------------------------------- |
| `POSTED_WEB_URL`    | Your Posted URL, such as `https://posted.example.com`.                |
| `POSTED_API_URL`    | Your API URL, such as `https://posted-api.example.com`.               |
| `POSTED_SECRET`     | A generated secret used to protect sessions and provider credentials. |
| `POSTGRES_PASSWORD` | A different generated password for the bundled database.              |

Run this command twice to generate a separate value for each secret:

```sh
openssl rand -hex 32
```

Leave the remaining values as supplied for now. The PostgreSQL overlay sets the database connection for you. Keep `.env` private and back up `POSTED_SECRET` with your database; you will need the same secret when restoring an installation.

## 3. Start Posted

```sh
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --pull always --wait
```

This starts the database, API, worker and UI. The API prepares the database automatically. PostgreSQL data is kept in the `posted-postgres` Docker volume.

## 4. Route your domains

Configure your reverse proxy on the Docker host:

| Public domain                | Forward to              |
| ---------------------------- | ----------------------- |
| Your `POSTED_WEB_URL` domain | `http://127.0.0.1:4342` |
| Your `POSTED_API_URL` domain | `http://127.0.0.1:4341` |

Enable HTTPS for both domains. The worker and database stay on the private Docker network.

## 5. Create your team

Find the setup secret in the API startup log:

```sh
docker compose logs api
```

Open your Posted URL, enter the setup secret and create the first administrator. Do not share the setup secret or startup log publicly.

Next, [connect a social account](/connections) and [compose your first post](/composer). See [Configuration](/configuration) to enable providers and S3 source. If startup fails, check [Troubleshooting](/troubleshooting).

## Use an existing database

Use PostgreSQL 17 and set `DATABASE_URL` in `.env` to a connection URI reachable from the containers. `localhost` inside a container refers to that container, not the Docker host.

Start without the bundled PostgreSQL overlay:

```sh
docker compose up -d --pull always --wait
```

Continue with the domain routing and team setup above.

## Build from source

The Dockerfile installs its own Node.js and pnpm dependencies. You only need Docker on the build host.

In a source checkout, prepare `.env` as described above, then build and start the containers:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.postgres.yml build
docker compose -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.postgres.yml up -d --no-build --wait
```

Omit `-f docker-compose.postgres.yml` from both commands if you use an existing database.
