# Stamper app (web capture) image. Build context: this repository's root.
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_RPC_URLS=... -t <tag> .
# NEXT_PUBLIC_* values are inlined at build time, so they are build args. @stamper/* packages come
# from vendor/ (see pnpm-workspace.yaml overrides) until they are published on npm.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
ARG NEXT_PUBLIC_CHAIN_ID=314159
ARG NEXT_PUBLIC_RPC_URLS
ARG NEXT_PUBLIC_REGISTRY_ADDRESS
ARG NEXT_PUBLIC_RESOLVER_ADDRESS
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ORIGIN
ARG NEXT_PUBLIC_VERIFY_BASE_URL
ARG NEXT_PUBLIC_FILBEAM_PAYER
ARG NEXT_PUBLIC_FILBEAM_BASE
ARG NEXT_PUBLIC_MIRROR_URL
ARG NEXT_PUBLIC_EXPLORERS
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --filter @stamper/app... \
 && pnpm --filter @stamper/app build \
 && pnpm --filter @stamper/app deploy --prod --legacy /out \
 && cp -r apps/web/.next apps/web/public /out/

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /out /app
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]
