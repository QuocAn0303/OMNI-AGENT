FROM node:20-alpine
ARG CACHE_BUST=20260521v2
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci --only=production
RUN npx prisma generate

COPY src ./src/
COPY ecosystem.config.js ./

# Phân hệ Multi-Agent (Bước 9): runtime `agents/`, hợp đồng skill và MCP server.
# `GET /api/agent-gateway/agents-overview` đọc thẳng ba thư mục này ở runtime, nên
# image production thiếu chúng sẽ trả 503 hoặc danh sách rỗng.
COPY agents/ ./agents/
COPY skills/ ./skills/
COPY mcp_servers/ ./mcp_servers/

ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node src/app.js"]
