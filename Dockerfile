# The meca-sword app for Cloud Run. Build from the repo root (it needs the workspace packages):
#
#   docker build --platform linux/amd64 -t meca-sword .
#
# At runtime the whole app-config comes from the APP_CONFIG environment variable (JSON), and
# PUBLIC_URL sets the public URL; see apps/meca-sword/README.md.
FROM oven/bun:1.4.2 AS source
WORKDIR /repo
COPY package.json bun.lock bunfig.toml turbo.json tsconfig.base.json ./
COPY packages packages
COPY apps apps

FROM source AS build
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@curvenote/meca-sword-app...

FROM source AS prod-deps
RUN bun install --frozen-lockfile --production

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=source /repo/package.json ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/meca-sword/package.json /repo/apps/meca-sword/.app-config.schema.yml /repo/apps/meca-sword/server.js ./apps/meca-sword/
COPY --from=build /repo/apps/meca-sword/build ./apps/meca-sword/build
WORKDIR /repo/apps/meca-sword
EXPOSE 8080
CMD ["node", "server.js"]
