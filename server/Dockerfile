FROM oven/bun:1.3.11 AS dependencies
WORKDIR /app
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.11 AS runner
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/data/nacre.sqlite
COPY --from=dependencies /app/node_modules ./node_modules
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY server/data/*.json ./server/data/
COPY frontend/src/lib ./frontend/src/lib
RUN mkdir /data && chown bun:bun /data
USER bun
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD bun -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server/src/index.ts"]
