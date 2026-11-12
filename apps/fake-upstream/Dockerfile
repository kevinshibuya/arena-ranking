# The fake upstream as a container, for `pnpm stack:smoke` only; never shipped.
# Repository root as context.
FROM node:22.23.3-alpine3.24
RUN npm install -g tsx@4.23.15
WORKDIR /app
COPY apps/fake-upstream/package.json ./
COPY apps/fake-upstream/src src
COPY apps/fake-upstream/fixtures-anon fixtures-anon
USER node
ENV HOST=0.0.0.0 PORT=9000
EXPOSE 9000
CMD ["tsx", "src/main.ts"]
