# GoverHub yerel demo — imajlar. Derleme bağlamı depo köküdür (compose.yaml: context ..).
# Yalnızca demo verisi; üretim için değildir.

# ── Web uygulaması (mobil uygulamanın web derlemesi). API aynı adreste: /api ──
FROM node:22-bookworm-slim AS web
WORKDIR /build/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY mobile/ ./
ENV EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_URL=/api
RUN npx expo export --platform web --output-dir /web

# ── Veritabanı: PostgreSQL 16 + ilk kurulumda rolleri ve veritabanını açan betik ──
FROM postgres:16-bookworm AS db
COPY yerel-demo/db/ilk-kurulum.sql /docker-entrypoint-initdb.d/01-goverhub.sql

# ── HTTPS'siz yerel vekil + tünel girişi için erişim kapısı ──
FROM caddy:2.8.4-alpine AS proxy
COPY --from=web /web /srv/web
COPY yerel-demo/proxy/ /etc/goverhub/
RUN sed -i "s/\r$//" /etc/goverhub/*.sh /etc/goverhub/*.sablon && chmod +x /etc/goverhub/*.sh
ENTRYPOINT ["/etc/goverhub/baslat.sh"]

# ── API ──
FROM node:22-bookworm-slim AS app
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY server/ ./
COPY yerel-demo/app/baslat.sh /usr/local/bin/goverhub-baslat
RUN sed -i 's/\r$//' /usr/local/bin/goverhub-baslat && chmod +x /usr/local/bin/goverhub-baslat \
 && mkdir -p /var/lib/goverhub/kanit /var/lib/goverhub/ayar && chown -R node:node /var/lib/goverhub
USER node
ENTRYPOINT ["/usr/local/bin/goverhub-baslat"]
