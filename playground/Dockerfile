FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV PLAYGROUND_PORT=5174
EXPOSE 5174

CMD ["npm", "run", "start"]
