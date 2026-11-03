# Paperflow — production image with LibreOffice (Office conversion) and fonts.
# Build:  docker build -t paperflow .
# Run:    docker run -p 3210:3210 paperflow

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-pdf-worker.mjs scripts/
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Render passes these in at build time; page metadata (social previews) needs the public address
ARG APP_URL
ARG RENDER_EXTERNAL_URL
ARG NEXT_PUBLIC_APP_NAME
RUN node scripts/copy-pdf-worker.mjs && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS run
# LibreOffice (headless) + fonts metric-compatible with Microsoft Office (Carlito/Caladea/Liberation)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
      fonts-dejavu fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core \
      tini \
    && rm -rf /var/lib/apt/lists/*
# Memory: small instances (Render free/starter, 512 MB) also run LibreOffice next to Node, so Node's heap is
# capped (raise it on bigger instances via NODE_OPTIONS) and glibc keeps fewer memory arenas.
ENV NODE_ENV=production \
    PORT=3210 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    SOFFICE_PATH=/usr/bin/soffice \
    NODE_OPTIONS=--max-old-space-size=256 \
    MALLOC_ARENA_MAX=2
WORKDIR /app
RUN useradd --create-home --uid 1001 paperflow && mkdir -p /data && chown paperflow /data
COPY --from=build --chown=paperflow /app/.next ./.next
COPY --from=build --chown=paperflow /app/node_modules ./node_modules
COPY --from=build --chown=paperflow /app/public ./public
COPY --from=build --chown=paperflow /app/package.json /app/next.config.mjs ./
USER paperflow
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/capabilities').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node node_modules/next/dist/bin/next start -p ${PORT} -H 0.0.0.0"]
