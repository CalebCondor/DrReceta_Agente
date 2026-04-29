# Dockerfile
# Etapa 1: Construcción
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Instalar dependencias con Bun (mucho más rápido que npm)
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copiar el resto de los archivos y construir
COPY . .
RUN bun run build

# Etapa 2: Ejecución
FROM oven/bun:1-alpine

WORKDIR /app

# Solo copiar archivos necesarios para ejecución
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
