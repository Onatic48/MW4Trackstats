FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json

RUN npm ci

COPY shared ./shared
COPY server ./server
COPY client ./client

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV SERVE_CLIENT_DIST=true
ENV TRUST_PROXY=true
ENV DATABASE_PATH=/app/server/data/mw4trackstats.sqlite
ENV IMAGES_DIR=/app/server/data/images

RUN mkdir -p /app/server/data/images

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
