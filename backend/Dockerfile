FROM node:22-alpine

WORKDIR /app

# Install as the `node` user, not root, so anything the dev server writes under
# /app stays writable by the user the container runs as. Chowning the dependency
# tree after a root install would duplicate it into an extra layer.
RUN chown node:node /app
USER node

# Dependencies, in their own layer so they are only reinstalled when the
# manifests change.
COPY --chown=node:node package*.json ./
RUN npm install

# Source
COPY --chown=node:node . .

EXPOSE 3001

CMD ["npm", "run", "dev"]
