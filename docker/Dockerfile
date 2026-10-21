FROM scratch AS prisma_engines
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_CACHE=/tmp/npm-cache PRISMA_CLI_QUERY_ENGINE_TYPE=client
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/kpi-engine/package.json packages/kpi-engine/package.json
RUN --mount=type=cache,target=/tmp/npm-cache --mount=type=secret,id=cloud_ca --mount=type=bind,from=prisma_engines,target=/run/prisma-engines,readonly \
    if [ -f /run/secrets/cloud_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cloud_ca; fi; \
    if [ -f /run/prisma-engines/schema-engine ]; then export PRISMA_SCHEMA_ENGINE_BINARY=/run/prisma-engines/schema-engine; fi; \
    if [ -f /run/prisma-engines/libquery_engine.so.node ]; then export PRISMA_QUERY_ENGINE_LIBRARY=/run/prisma-engines/libquery_engine.so.node; fi; \
    npm ci --no-audit --no-fund && \
    if [ -f /run/prisma-engines/schema-engine ]; then cp /run/prisma-engines/schema-engine node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x; chmod 755 node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x; fi && \
    if [ -f /run/prisma-engines/libquery_engine.so.node ]; then cp /run/prisma-engines/libquery_engine.so.node node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node; fi
COPY . .
RUN --mount=type=cache,target=/tmp/npm-cache --mount=type=secret,id=cloud_ca if [ -f /run/secrets/cloud_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cloud_ca; fi; npm run db:generate && npm run build
FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_CACHE=/tmp/npm-cache
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["npm","start"]
