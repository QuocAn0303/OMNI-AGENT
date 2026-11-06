FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY deploy/railway/prisma.config.ts ./prisma.config.ts
# Prisma CLI is needed for migrate deploy at startup.
RUN npm ci && DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate
COPY src ./src
COPY agents ./agents
COPY skills ./skills
COPY mcp_servers ./mcp_servers
COPY evals ./evals
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && exec node src/app.js"]
