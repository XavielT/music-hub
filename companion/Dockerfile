# Node is the base rather than Python, because the awkward dependency is the
# POT provider (a Node server) and Debian's packaged node is too old for it.
# Python is the easy half to add.
FROM node:22-bookworm-slim AS provider

# Proof-of-origin tokens. Without these, YouTube answers a request from any
# datacenter address with "Sign in to confirm you're not a bot" — which is
# exactly what a free container is, and why this image is not just python+ffmpeg.
ARG BGUTIL_VERSION=2.0.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --single-branch --branch ${BGUTIL_VERSION} \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /src
WORKDIR /src/server
RUN npm ci && npx tsc

# --- runtime ---
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY companion/requirements.txt .
# Debian marks its Python as externally managed; this image has no other
# Python application to conflict with.
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

# The plugin half of the pair: yt-dlp finds it on the plugin path and asks the
# server below for a token.
RUN pip install --no-cache-dir --break-system-packages bgutil-ytdlp-pot-provider==2.0.0

COPY --from=provider /src/server/build /opt/bgutil/build
COPY --from=provider /src/server/node_modules /opt/bgutil/node_modules

COPY companion/app.py .
COPY companion/entrypoint.sh .
RUN chmod +x entrypoint.sh

RUN useradd --create-home --uid 10001 companion
USER companion

ENV PORT=8080
EXPOSE 8080
CMD ["./entrypoint.sh"]
