FROM docker.io/library/node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS dependencies
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/minerva-app/package.json ./apps/minerva-app/
COPY patches/ ./patches/
COPY packages/ ./packages/
RUN --mount=type=cache,id=pnpm,sharing=locked,target=/pnpm/store pnpm install --frozen-lockfile
RUN test -f packages/foliate-js/vendor/pdfjs/annotation_layer_builder.css \
    && test -d packages/simplecc-wasm/dist/web \
    || { printf '\nERROR: Required git submodules are not initialized in the source directory.\nEnsure submodules are initialized before running docker build.\nRun: git submodule update --init packages/foliate-js packages/simplecc-wasm\n\n'; exit 1; }
RUN pnpm --filter @minerva/app setup-vendors

FROM docker.io/library/node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS development-stage
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
COPY --from=dependencies /app /app
COPY . .
WORKDIR /app/apps/minerva-app
EXPOSE 3000
ENTRYPOINT ["pnpm", "dev-web", "-H", "0.0.0.0"]

FROM docker.io/library/node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_PLATFORM
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_OBJECT_STORAGE_TYPE
ARG NEXT_PUBLIC_STORAGE_FIXED_QUOTA
ARG NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/apps/minerva-app/node_modules /app/apps/minerva-app/node_modules
COPY --from=dependencies /app/apps/minerva-app/public/vendor /app/apps/minerva-app/public/vendor
COPY --from=dependencies /app/packages/foliate-js/node_modules /app/packages/foliate-js/node_modules
COPY . .
WORKDIR /app/apps/minerva-app
# Opt into the self-contained `.next/standalone` tree for this image only;
# next.config.mjs gates `output: 'standalone'` on BUILD_STANDALONE so other
# web builds keep their default output.
ENV BUILD_STANDALONE=true
RUN pnpm build-web

# Production runtime ships only the standalone server, its traced node_modules,
# and the static/public assets — no pnpm, no source tree, no dev dependencies,
# no build cache. `output: 'standalone'` (next.config.mjs) emits the self-contained
# tree under .next/standalone, so the entrypoint is a plain `node server.js`.
FROM docker.io/library/node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS production-stage
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# This image is the self-hosted artifact — web.minerva.invalid runs on
# Cloudflare/Vercel, never on it — so premium features are unlocked by default
# rather than left to the operator's compose file. `compose.yaml` passes
# `SELF_HOSTED: ${SELF_HOSTED:-true}`, but that line only landed in #5996: a
# compose file copied before it survives every `docker compose pull`, so the
# container came up gated with nothing on screen to explain why (#6093).
# An operator running a hosted service that sells plans sets SELF_HOSTED=false.
ENV SELF_HOSTED=true
WORKDIR /app
# Monorepo-rooted standalone tree: server.js + hoisted, traced node_modules.
COPY --from=build --chown=node:node /app/apps/minerva-app/.next/standalone ./
# Static and public assets are not part of the standalone trace; copy them next
# to the server so their default relative paths resolve.
COPY --from=build --chown=node:node /app/apps/minerva-app/.next/static ./apps/minerva-app/.next/static
COPY --from=build --chown=node:node /app/apps/minerva-app/public ./apps/minerva-app/public
USER node
EXPOSE 3000
ENTRYPOINT ["node", "apps/minerva-app/server.js"]
