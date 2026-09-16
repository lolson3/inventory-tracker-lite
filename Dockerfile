# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY client ./client
COPY scripts ./scripts
COPY tests ./tests
COPY inventory_program.html styles.css ./
COPY img ./img
RUN npm test

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY inventory_program.html styles.css ./
COPY img ./img
RUN mkdir -p /data /backups && chown node:node /data /backups && chmod 700 /data /backups
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/data',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
