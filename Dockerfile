FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production
RUN npx prisma generate

COPY src ./src/
COPY ecosystem.config.js ./

EXPOSE 4000
CMD ["npx", "pm2-runtime", "ecosystem.config.js"]
