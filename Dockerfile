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

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/app.js"]
