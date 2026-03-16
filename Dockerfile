# === Build Frontend ===
FROM node:25-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# === Production Image ===
FROM python:3.13-slim
WORKDIR /app

ARG YTDLP_VERSION=latest

# Install FFmpeg + Opus
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libopus0 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    if [ "$YTDLP_VERSION" = "latest" ]; then \
      pip install --no-cache-dir --upgrade yt-dlp; \
    else \
      pip install --no-cache-dir --upgrade "yt-dlp==$YTDLP_VERSION"; \
    fi

# Copy backend
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./static/

# Copy plugin files (will be installed to TeddyCloud plugins dir on startup)
COPY plugin/ ./plugin/

# Copy default assets
COPY assets/ ./assets/

# Copy entrypoint script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
