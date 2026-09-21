FROM node:22-alpine

WORKDIR /app

# Install as the `node` user, not root: Vite writes its dependency-optimizer
# cache into node_modules/.vite at startup, so that tree must be writable by the
# user the container runs as. This used to work only by accident — the host
# node_modules arrived via `COPY --chown=node:node . .`. With .dockerignore
# excluding it, the install below is what ships, and chowning ~490 MB after the
# fact would duplicate the whole tree into an extra layer.
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

EXPOSE 5173

# Dev server by default; FRONTEND_MODE=preview serves a production build
# instead. The script owns the switch so the compose file and this recipe
# cannot disagree about what each mode runs.
CMD ["./docker-entrypoint.sh"]
