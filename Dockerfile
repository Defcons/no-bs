# Multi-stage: build the Vite PWA, then serve the static output with nginx.
FROM node:20-alpine AS build
WORKDIR /app
ARG APP_VERSION=dev
# Public build config only. VITE_APP_URL = the app's public origin (shareable
# route-link base). The old VITE_SYNC_*/VITE_SEED personal-config args are GONE —
# since 1.47.0 no build bakes in personal config (SECURITY INVARIANT, see
# OrientationMap.md): sync is configured per-device in Settings. Do not re-add.
ARG VITE_APP_URL=
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN printf 'VITE_APP_URL=%s\n' "$VITE_APP_URL" > .env.production \
  && npm run build \
  && rm -f .env.production
# OTA bundle for the native app: a zip of the built web app + a version manifest
# the app polls (see src/lib/update.ts). Version = semver (package.json) + git sha
# build metadata, so it's human-readable (vX.Y.Z) yet unique per deploy. checksum =
# the zip's SHA-256, which Capgo checks on download (and requires once the app carries
# a bundle-signing public key).
RUN apk add --no-cache zip \
  && SEMVER="$(node -p "require('./package.json').version")" \
  && (cd dist && zip -qr "/app/bundle-${APP_VERSION}.zip" .) \
  && SUM="$(sha256sum "/app/bundle-${APP_VERSION}.zip" | cut -d' ' -f1)" \
  && printf '{"version":"%s+%s","url":"https://app.agentas.net/bundle-%s.zip","checksum":"%s"}\n' "$SEMVER" "$APP_VERSION" "$APP_VERSION" "$SUM" > /app/version.json

FROM nginxinc/nginx-unprivileged:alpine
# Not root: this image runs nginx as uid 101 (pid file and temp paths in /tmp) and listens on 3060, the published host
# port. Clearing the stock page needs root, so only that step runs as root; the compose file pins the user too.
USER root
RUN rm -rf /usr/share/nginx/html/*
USER 101
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Fail the build (old container keeps serving) instead of shipping a config nginx rejects. Runs as 101 on purpose:
# nginx -t creates its temp dirs, and root-made ones in /tmp would be unusable for the user the container runs as.
RUN nginx -t
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/bundle-*.zip /app/version.json /usr/share/nginx/html/
EXPOSE 3060
CMD ["nginx", "-g", "daemon off;"]
