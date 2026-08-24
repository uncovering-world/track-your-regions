FROM node:22-alpine

WORKDIR /app

# Install as the `node` user, not root: Vite writes its dependency-optimizer
# cache into node_modules/.vite at startup, so that tree must be writable by the
# user the container runs as. This used to work only by accident — the host
# node_modules arrived via `COPY --chown=node:node . .`. With .dockerignore
# excluding it, the install below is what ships, and chowning ~490 MB after the
# fact would duplicate the whole tree into an extra layer.
RUN chown node:node /app
USER node

# Dependencies, in their own layer so they are only reinstalled when the
# manifests change.
COPY --chown=node:node package*.json ./
RUN npm install

# Source
COPY --chown=node:node . .

EXPOSE 5173

# Dev server by default; FRONTEND_MODE=preview serves a production build
# instead. The script owns the switch so the compose file and this recipe
# cannot disagree about what each mode runs.
CMD ["./docker-entrypoint.sh"]
