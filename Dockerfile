# Multi-stage build: install all deps and build, then ship a runtime image
# with only what's needed at runtime.

FROM node:20-slim AS builder
WORKDIR /app

# Build stage needs all deps including dev (for vite, esbuild, tsx)
COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime only needs production deps. The bundle in dist/index.cjs already
# inlines the allowlisted deps (see script/build.ts), but the externals
# (most node_modules) still need to be installed here.
COPY package*.json ./
RUN npm install --production --legacy-peer-deps && \
    npm cache clean --force

# Bundled server + built client static files
COPY --from=builder /app/dist ./dist

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.cjs"]
