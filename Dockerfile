FROM node:22-alpine AS build
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm run build

FROM node:22-alpine AS deps
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache openssl \
  && openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
     -keyout testpk.pem -out fullchain.pem \
     -subj "/C=GB/ST=London/L=London/O=Echo/CN=localhost" \
     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  && apk del openssl \
  && rm -rf /var/cache/apk/* \
  && chown node:node testpk.pem fullchain.pem \
  && chmod 400 testpk.pem

COPY --from=deps /app/node_modules node_modules/
COPY --from=build /app/dist dist/
COPY package.json ./

ENV HTTP_PORT=8080 HTTPS_PORT=8443
EXPOSE 8080 8443
USER node
CMD ["node", "dist/index.js"]
