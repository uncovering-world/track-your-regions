FROM node:20-slim

# Fonts for sharp SVG text rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY --chown=node:node . .

RUN chown node:node /app

EXPOSE 3001

USER node
CMD ["npm", "run", "dev"]
