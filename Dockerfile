# fretwork is a purely client-side app — this image just builds the static bundle and serves it.
# There is no backend, no database, and no state on the server; everything lives in the browser.

# ---- build ----------------------------------------------------------------
# Node 24 line, matching `.tool-versions` and the Pages workflow. Not pinned to a patch: the
# lockfile is what makes the build reproducible, and floating on 24.x picks up security fixes.
FROM node:24-alpine AS build

# Where the app will be served from. Baked in at build time, because every runtime asset URL is
# derived from Vite's `base` (`import.meta.env.BASE_URL`). Default `/` = mounted at the domain root.
# For a subpath deploy, build with `--build-arg BASE_PATH=/fretwork/` (leading AND trailing slash).
ARG BASE_PATH=/

WORKDIR /app

RUN npm install --global pnpm@11.2.2

# Dependency layer, cached until the manifests change. pnpm-workspace.yaml is required here, not
# optional: it carries `allowBuilds: esbuild: true`, without which pnpm blocks esbuild's postinstall
# and the vite build fails later with a much less obvious error.
#
# The project `.npmrc` is deliberately NOT copied. It exists only to override a registry/quarantine
# config in the developer's home directory; the container has neither that file nor the matching
# env vars, so npmjs.org is already the default here. Copying it would also make this build fail on
# a fresh clone, since `.npmrc` isn't committed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN BASE_PATH="$BASE_PATH" pnpm build

# ---- serve ----------------------------------------------------------------
# alpine-slim is the smallest official nginx variant (~12 MB): no njs, no perl, no image-filter —
# none of which this static site uses. 1.31 is the current mainline branch.
FROM nginx:1.31-alpine-slim AS serve

ARG BASE_PATH=/

COPY nginx.conf /etc/nginx/conf.d/default.conf
# Land the bundle under the same path it was built for, so a subpath build is served at that
# subpath without any extra proxy rewriting.
COPY --from=build /app/dist /usr/share/nginx/html/${BASE_PATH}

EXPOSE 80
