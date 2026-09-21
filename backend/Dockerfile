FROM node:22-alpine

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
