# Portability artifact: the same container runs on Fly.io, Koyeb, Cloud Run, Railway,
# or any Docker host — so "swap host later" stays a config move, not a rewrite.
# Render itself uses the native Node runtime (render.yaml) and ignores this file.
FROM node:24-alpine
WORKDIR /app

# Zero runtime deps, but install keeps the contract honest if any are added later.
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Hosts inject PORT; default matches src/server.ts for local `docker run`.
ENV PORT=8787
EXPOSE 8787
CMD ["node", "src/server.ts"]
