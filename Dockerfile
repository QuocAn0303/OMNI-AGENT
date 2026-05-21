FROM node:20-alpine

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
