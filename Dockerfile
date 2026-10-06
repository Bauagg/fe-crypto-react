# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------------------------
# Tahap 1: build Vite. Variabel VITE_* ditanam ke bundle saat build (bukan saat container jalan),
# jadi diberikan lewat build arg.
# ---------------------------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------------------------
# Tahap 2: Nginx non-root (port 8080) hanya menyajikan file statis hasil build.
# ---------------------------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
