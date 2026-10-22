# The base the image is built on, named by a stage below. The backend runs on
# Alpine. The dump worker builds the same steps on a Debian base that carries
# the OpenStreetMap tools its layer build runs (ADR-0134): Alpine packages
# neither osmium-tool nor osm2pgsql. docker-compose.yml passes BASE=node-osm
# for the dump-worker service.
ARG BASE=node-alpine

FROM node:22-alpine AS node-alpine

FROM node:22-trixie-slim AS node-osm
# osmium cuts the layer from the planet and applies the daily diffs; osm2pgsql
# loads it through a flex style. bzip2 is the decoder the dump reader spawns
# for a .bz2 file (`decompressor` in src/services/dumps/read.ts), which Alpine
# has from busybox and the slim Debian image does not ship. Their versions
# follow the Debian release of the base image, as the GADM loader's do, so they
# are not pinned one by one.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        bzip2 \
        osmium-tool \
        osm2pgsql \
 && rm -rf /var/lib/apt/lists/*

# BASE names one of the two stages above, whose images are tagged there;
# hadolint cannot resolve a variable to a stage alias.
# hadolint ignore=DL3006
FROM ${BASE}

WORKDIR /app

# Install as the `node` user, not root, so anything the dev server writes under
# /app stays writable by the user the container runs as. Chowning the dependency
# tree after a root install would duplicate it into an extra layer.
RUN chown node:node /app
# The rules both sides apply are a package outside this build context
# (packages/shared, ADR-0065), handed in by docker-compose.yml as the named
# context `shared`. It lands where `file:../packages/shared` in package.json
# finds it from /app — the same relative path as on a checkout — so the
# install below links it exactly as `npm install` on the host does.
RUN mkdir -p /packages/shared && chown node:node /packages/shared
USER node

# Dependencies, in their own layer so they are only reinstalled when the
# manifests change.
# `shared` is a named build context (docker-compose.yml additional_contexts),
# which hadolint reads only as a missing FROM alias.
# hadolint ignore=DL3022
COPY --from=shared --chown=node:node . /packages/shared
COPY --chown=node:node package*.json ./
RUN npm install

# Source
COPY --chown=node:node . .

EXPOSE 3001

CMD ["npm", "run", "dev"]
