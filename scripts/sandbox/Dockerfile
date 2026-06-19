FROM node:24-slim

RUN useradd -m -s /bin/bash sandbox

WORKDIR /app

RUN ln -s /app/dist/main.mjs /usr/local/bin/nova

ENV HOME=/home/sandbox

USER sandbox

CMD ["bash"]