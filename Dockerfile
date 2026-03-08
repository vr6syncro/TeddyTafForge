# === Build Frontend ===
FROM node:25-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# === Production Image ===
FROM python:3.14-slim
WORKDIR /app

ARG YTDLP_VERSION=latest
ARG APP_UID=10001
ARG APP_GID=10001

# Install FFmpeg + Opus
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libopus0 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create dedicated runtime user and prepare writable defaults for fresh named volumes.
RUN groupadd --system --gid "${APP_GID}" tafforge && \
    useradd --system --uid "${APP_UID}" --gid "${APP_GID}" --create-home --home-dir /home/tafforge tafforge && \
    mkdir -p /teddycloud/config /teddycloud/library/custom_taf /teddycloud/data/www/plugins && \
    chown -R tafforge:tafforge /app /home/tafforge /teddycloud

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    if [ "$YTDLP_VERSION" = "latest" ]; then \
      pip install --no-cache-dir --upgrade yt-dlp; \
    else \
      pip install --no-cache-dir --upgrade "yt-dlp==$YTDLP_VERSION"; \
    fi

# Copy backend
COPY --chown=tafforge:tafforge backend/ ./backend/

# Copy built frontend
COPY --chown=tafforge:tafforge --from=frontend-build /app/frontend/dist ./static/

# Copy plugin files (will be installed to TeddyCloud plugins dir on startup)
COPY --chown=tafforge:tafforge plugin/ ./plugin/

# Copy default assets
COPY --chown=tafforge:tafforge assets/ ./assets/

# Copy entrypoint script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh && chown tafforge:tafforge entrypoint.sh

USER tafforge

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
