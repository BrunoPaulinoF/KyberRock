# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY apps/loader-web/package.json ./apps/loader-web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/scale-adapters/package.json ./packages/scale-adapters/
COPY packages/omie-client/package.json ./packages/omie-client/
COPY packages/print-templates/package.json ./packages/print-templates/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build only the loader-web app (avoid building desktop and other workspaces in Docker)
RUN npm run build -w @kyberrock/loader-web

# Production stage
FROM nginx:alpine

# Copy built app from builder stage
COPY --from=builder /app/apps/loader-web/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/loader-web/nginx.conf /etc/nginx/conf.d/default.conf

# Generate runtime frontend config from container env before nginx starts
COPY apps/loader-web/docker-entrypoint.d/10-kyberrock-env.sh /docker-entrypoint.d/10-kyberrock-env.sh
RUN chmod +x /docker-entrypoint.d/10-kyberrock-env.sh

# Expose port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
