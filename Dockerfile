FROM node:20-alpine

# Installer les dépendances nécessaires pour Puppeteer/Chrome
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Définir Chrome comme executable par défaut (seulement si on utilise Docker)
# Sur Render sans Docker, Puppeteer téléchargera Chrome automatiquement
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8000

CMD ["npm", "run", "dev"]
