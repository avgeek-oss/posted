# syntax=docker/dockerfile:1.7
FROM node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a AS base

FROM base AS build
ARG RELEASE_VERSION=0.2.0
WORKDIR /build
RUN npm install --global pnpm@11.5.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web-server/package.json ./apps/web-server/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/web-design-system/package.json ./packages/web-design-system/package.json
RUN --mount=type=cache,id=posted-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
RUN node -e "const fs=require('node:fs'); const versions=['package.json','apps/web/package.json','apps/web-server/package.json'].map(path=>JSON.parse(fs.readFileSync(path)).version); if(versions.some(version=>version!==process.argv[1])) throw new Error('API, worker and UI must use the package version');" "$RELEASE_VERSION"
RUN pnpm build
RUN --mount=type=cache,id=posted-pnpm,target=/pnpm/store,sharing=locked \
    pnpm --filter posted deploy --prod --offline --store-dir /pnpm/store /prod/posted \
    && pnpm --filter @posted/web-server deploy --prod --offline --store-dir /pnpm/store /prod/web

FROM base AS runtime
ARG SOURCE_COMMIT=development
ARG RELEASE_VERSION=0.2.0
LABEL org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.version="${RELEASE_VERSION}"
WORKDIR /app
ENV NODE_ENV=production
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --chown=node:node LICENSE NOTICE ./
USER node

FROM runtime AS server
ENV POSTED_MIGRATIONS_DIR=/app/packages/database/migrations
COPY --from=build --chown=node:node /prod/posted/node_modules ./node_modules
COPY --from=build --chown=node:node /build/package.json ./package.json
COPY --from=build --chown=node:node /build/dist/package.json ./dist/package.json
COPY --from=build --chown=node:node /build/dist/apps/api ./dist/apps/api
COPY --from=build --chown=node:node /build/dist/apps/worker ./dist/apps/worker
COPY --from=build --chown=node:node /build/dist/apps/shared ./dist/apps/shared
COPY --from=build --chown=node:node /build/dist/packages ./dist/packages
COPY --from=build --chown=node:node /build/packages/database/migrations ./packages/database/migrations

FROM server AS api
LABEL org.opencontainers.image.title="Posted API"
ENV PORT=4341
EXPOSE 4341
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
    CMD node -e "fetch('http://127.0.0.1:4341/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/api/src/index.js"]

FROM server AS worker
USER root
RUN apk add --no-cache ffmpeg
COPY --chown=node:node third-party/ffmpeg ./third-party/ffmpeg
USER node
LABEL org.opencontainers.image.title="Posted worker"
ENV PORT=4343
EXPOSE 4343
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
    CMD node -e "fetch('http://127.0.0.1:4343/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/worker/src/index.js"]

FROM runtime AS web
LABEL org.opencontainers.image.title="Posted UI"
ENV PORT=4342
COPY --from=build --chown=node:node /prod/web/node_modules ./node_modules
COPY --from=build --chown=node:node /build/apps/web-server/package.json ./package.json
COPY --from=build --chown=node:node /build/dist/apps/web-server ./dist/apps/web-server
COPY --from=build --chown=node:node /build/dist/apps/shared ./dist/apps/shared
COPY --from=build --chown=node:node /build/apps/web/dist ./apps/web/dist
EXPOSE 4342
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
    CMD node -e "fetch('http://127.0.0.1:4342/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/web-server/src/index.js"]
