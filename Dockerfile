# Marbexa 2.0 — image de production.
# Aucune dépendance npm : Node seul suffit.
FROM node:22-alpine

WORKDIR /app
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY package.json README.md ./

# La base JSON et ses sauvegardes vivent hors de l'image, sur un volume.
ENV NODE_ENV=production \
    PORT=3000 \
    MARBEXA_DATA=/data/db.json
VOLUME /data
EXPOSE 3000

CMD ["node", "server/index.js"]
