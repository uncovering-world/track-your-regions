# Use the official Node.js image
FROM node:22.2-bookworm-slim

# Set working directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy app source code
COPY . .

# Set environment variables (you can also use a .env file)
ENV DB_HOST=$DB_HOST
ENV DB_PORT=$DB_PORT
ENV DB_NAME=$DB_NAME
ENV DB_USER=$DB_USER

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["npm", "run", "debug"]
