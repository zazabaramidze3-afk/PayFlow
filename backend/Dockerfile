# ==========================================================
# backend/Dockerfile — PayFlow backend, Render.com deployment
# ==========================================================
# Multi-stage build:
#   1) builder     — devDependencies + `tsc`-ით src/ -> dist/ კომპილაცია
#   2) production  — მხოლოდ runtime dependencies + კომპილირებული dist/,
#                     მინიმალური image ზომისთვის.
#
# Render-ზე: New → Web Service → Runtime: Docker → Root Directory: backend
# (ან render.yaml blueprint, იხ. repo root-ში).

# ---------- Stage 1: Build ----------
FROM node:22-alpine AS builder
WORKDIR /app

# ⚠️ bcrypt-ს native addon აქვს — Alpine (musl libc) ხშირად საჭიროებს
# კომპილაციის ხელსაწყოებს, თუ პრებილდილი ბაინარი ზუსტ პლატფორმას არ
# ემთხვევა. ეს stage საბოლოო image-ში არ ხვდება (multi-stage build),
# ამიტომ აქ cleanup საჭირო არ არის.
RUN apk add --no-cache python3 make g++

# დამოკიდებულებები ცალკე ფენად (Docker layer caching) — package*.json
# ცოტა თუ იცვლება, `npm ci` აღარ გაეშვება ყოველ კოდის ცვლილებაზე.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# `npm run build` = `tsc && copy-assets` (fonts/-ის dist/-ში გადატანა,
# იხ. backend/package.json — PDFKit-ის Sylfaen.ttf რომ production-შიც
# ხელმისაწვდომი იყოს, იხ. src/routes/products.ts, src/routes/sales.ts).
RUN npm run build

# ---------- Stage 2: Production ----------
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# build-deps დროებით — `npm ci --omit=dev`-ის შემდეგ იმავე ფენაში იშლება,
# რომ საბოლოო image-ს კომპილატორები აღარ დაუმატოს წონა.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Render დინამიურად აწვდის PORT env var-ს კონტეინერს — index.ts:
# `process.env.PORT || 5000`. EXPOSE მხოლოდ დოკუმენტაციისთვისაა.
EXPOSE 5000

# 💓 GET /api/health — Render-ის health check-ისთვის
# (render.yaml: healthCheckPath: /api/health).
CMD ["node", "dist/index.js"]
