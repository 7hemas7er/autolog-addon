# Il Supervisor passa BUILD_FROM=ghcr.io/home-assistant/base:latest e ignora
# il build_from dichiarato in build.yaml (accetta solo immagini del suo
# registry). L'immagine base la fissiamo qui: serve Node >= 22.5 per il modulo
# node:sqlite, e l'immagine ufficiale lo garantisce senza pacchetti aggiuntivi.
FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# /data è il volume persistente dell'add-on: DB e options.json vivono lì.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8099 \
    HOST=0.0.0.0

# Node gira come PID 1: server.js gestisce SIGTERM per chiudere pulito
# (pubblica "offline" su MQTT prima di uscire).
CMD ["node", "/app/server.js"]
