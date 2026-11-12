# The api and worker images, from one build of the backend: `--target api` or
# `--target worker`, with the repository root as context. linux/arm64 for the box,
# built on the Mac by deploy/stack/bin/build-images.sh.
ARG NODE_IMAGE=node:22.23.3-alpine3.24

FROM ${NODE_IMAGE} AS build
RUN npm install -g pnpm@11.5.2
WORKDIR /repo
# Manifests first, so the install layer survives source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/fake-upstream/package.json apps/fake-upstream/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
RUN pnpm --filter @arena/backend build \
  && pnpm --filter @arena/backend deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS backend
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./dist
COPY --from=build /repo/apps/backend/migrations ./migrations
# The node user (uid 1000) owns nothing here: the code is read-only to it.
USER node

FROM backend AS worker
CMD ["node", "dist/main.worker.js"]

FROM backend AS api
EXPOSE 3001
CMD ["node", "dist/main.api.js"]
