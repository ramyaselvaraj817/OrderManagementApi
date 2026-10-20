# ---- Stage 1: build TypeScript -> JavaScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Stage 2: small runtime image (no dev dependencies, no TS sources) ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Don't run as root inside the container
USER node
EXPOSE 3000
# Apply pending migrations, then start the server
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
