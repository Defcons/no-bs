# Multi-stage: build the Vite PWA, then serve the static output with nginx.
FROM node:20-alpine AS build
WORKDIR /app
ARG APP_VERSION=dev
# Personal build config (from GitHub secrets via docker-compose build args). Empty =
# a clean public build. Written to a throwaway .env.production so Vite bakes them.
ARG VITE_SYNC_URL=
ARG VITE_SYNC_SECRET=
ARG VITE_APP_URL=
ARG VITE_SEED=
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN printf 'VITE_SYNC_URL=%s\nVITE_SYNC_SECRET=%s\nVITE_APP_URL=%s\nVITE_SEED=%s\n' \
      "$VITE_SYNC_URL" "$VITE_SYNC_SECRET" "$VITE_APP_URL" "$VITE_SEED" > .env.production \
  && npm run build \
  && rm -f .env.production
# OTA bundle for the native app: a zip of the built web app + a version manifest
# the app polls (see src/lib/update.ts). Version = semver (package.json) + git sha
# build metadata, so it's human-readable (vX.Y.Z) yet unique per deploy.
RUN apk add --no-cache zip \
  && SEMVER="$(node -p "require('./package.json').version")" \
  && (cd dist && zip -qr "/app/bundle-${APP_VERSION}.zip" .) \
  && printf '{"version":"%s+%s","url":"https://app.agentas.net/bundle-%s.zip"}\n' "$SEMVER" "$APP_VERSION" "$APP_VERSION" > /app/version.json

FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/bundle-*.zip /app/version.json /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
