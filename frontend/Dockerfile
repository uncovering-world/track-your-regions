FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY --chown=node:node . .

# Vite needs to write temp files in /app/ at startup
RUN chown node:node /app

EXPOSE 5173

USER node
CMD ["npm", "run", "dev", "--", "--host"]
