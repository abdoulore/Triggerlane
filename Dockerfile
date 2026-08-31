FROM node:22-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production \
    API_HOST=127.0.0.1 \
    API_PORT=8787 \
    API_INTERNAL_URL=http://127.0.0.1:8787 \
    PGLITE_DATA_DIR=/data/triggerlane

RUN mkdir -p /data/triggerlane

EXPOSE 3000

CMD ["npm", "start"]
