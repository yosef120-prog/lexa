# Cloud Run builds this remotely, so no Docker is needed on the machine that
# deploys it.
FROM node:22-slim

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
# Cloud Run sets PORT; this is the local default.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
