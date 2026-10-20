FROM node:24-alpine
WORKDIR /app
COPY server ./server
RUN mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=4318 DATABASE_PATH=/data/clipgarden.sqlite
USER node
EXPOSE 4318
CMD ["node", "server/index.mjs"]
