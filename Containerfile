# keyring's image, built from a full clone at the commit being released (its
# build reads the commit from git). State: the database in /data. Give it
# KEYRING_MASTER_KEY, and KEYRING_ADMIN_TOKEN if wanted, in its environment.
ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN git config --global --add safe.directory /src \
 && npm ci --no-audit --no-fund --fetch-timeout=60000 --fetch-retries=5 \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && rm -rf .git

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=build /src /app
ENV NODE_ENV=production HOME=/tmp KEYRING_HOST=0.0.0.0 KEYRING_DB=/data/keyring.db
EXPOSE 4830
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["serve"]
