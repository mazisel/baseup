FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

# DİKKAT: Bu API kimlik doğrulaması içermez ve müşteri sunucularında
# root SSH komutları çalıştırır. Portu asla host'a publish etmeyin;
# yalnızca compose iç ağından (http://legacy:4567) erişilmelidir.
ENV PORT=4567
EXPOSE 4567

CMD ["node", "server.js"]
