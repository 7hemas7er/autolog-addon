# The Supervisor passes BUILD_FROM=ghcr.io/home-assistant/base:latest and
# ignores the build_from declared in build.yaml, accepting only images from its
# own registry. The base image is therefore pinned here: Node >= 22.5 is
# required for the node:sqlite module, and the official image provides it
# without any extra packages.
FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# /data is the add-on's persistent volume: the database and options.json live there.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8099 \
    HOST=0.0.0.0

# Node runs as PID 1: server.js handles SIGTERM to shut down cleanly
# (it publishes "offline" over MQTT before exiting).
CMD ["node", "/app/server.js"]
