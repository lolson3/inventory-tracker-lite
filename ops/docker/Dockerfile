# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY public ./public
RUN npm test

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5174 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir -p /data/backups && chown -R node:node /data && chmod 700 /data /data/backups
USER node
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5174)+'/api/data',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server/server.js"]
