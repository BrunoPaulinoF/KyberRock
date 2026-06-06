FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY apps/loader-web/package.json apps/loader-web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY functions/package.json functions/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/scale-adapters/package.json packages/scale-adapters/package.json
COPY packages/omie-client/package.json packages/omie-client/package.json
COPY packages/print-templates/package.json packages/print-templates/package.json

RUN npm install

COPY apps/loader-web apps/loader-web

RUN npm run build --workspace @kyberrock/loader-web

FROM nginx:1.27-alpine

COPY apps/loader-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/loader-web/dist /usr/share/nginx/html

EXPOSE 80
