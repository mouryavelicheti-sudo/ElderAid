# ---- Build the React client ----
FROM node:20-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---- Install server production dependencies ----
FROM node:20-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Runtime: Express serves the API and the built client ----
FROM node:20-bookworm-slim
WORKDIR /app
COPY server/ ./server/
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=client-build /app/client/dist ./client/dist
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server/index.js"]
