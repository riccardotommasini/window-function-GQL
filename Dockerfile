FROM node:22-bookworm-slim

WORKDIR /app

COPY playground/package.json playground/package-lock.json ./
RUN npm ci

COPY playground/ ./
RUN npm run build

ENV NODE_ENV=production
EXPOSE 5174

CMD ["npm", "run", "start"]
