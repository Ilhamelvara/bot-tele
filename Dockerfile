FROM node:24-bookworm-slim

# Install LibreOffice (minimal - Writer + Draw saja, tanpa GUI & Java)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice-writer \
        libreoffice-draw \
        libreoffice-common \
        fonts-liberation \
        fonts-dejavu-core \
        fontconfig \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Non-root user untuk keamanan
RUN useradd -m -u 1001 botuser

WORKDIR /app

# Install dependency Node.js
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy source code
COPY services/ ./services/
COPY index.js .

# Buat folder kerja & set kepemilikan
RUN mkdir -p temp output && chown -R botuser:botuser /app

USER botuser

# Set HOME agar LibreOffice bisa membuat profile sementara
ENV HOME=/tmp

# Jalankan bot
CMD ["node", "index.js"]