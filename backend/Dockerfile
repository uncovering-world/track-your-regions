FROM node:20-alpine

# Fonts for sharp SVG text rendering + glibc compat for onnxruntime-node
RUN apk add --no-cache fontconfig ttf-dejavu gcompat

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
