FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3002

CMD ["node", "--import", "tsx", "src/index.ts"]
