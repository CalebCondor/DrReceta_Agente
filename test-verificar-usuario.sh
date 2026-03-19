#!/usr/bin/env bash
# =============================================================================
# Test script: /api/verificar_o_registrar_usuario.php
# =============================================================================

API="https://www.doctorrecetas.com/api/verificar_o_registrar_usuario.php"
EMAIL="andreslg20@gmail.com"
BOLD="\033[1m"
CYAN="\033[1;36m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
RESET="\033[0m"

separator() { echo -e "\n${CYAN}─────────────────────────────────────────────────────${RESET}"; }

call() {
  local label="$1"
  local body="$2"
  separator
  echo -e "${BOLD}${label}${RESET}"
  echo -e "${YELLOW}Payload:${RESET} $body"
  echo ""
  RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
    -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "$body")
  HTTP_STATUS=$(echo "$RESPONSE" | grep "__HTTP_STATUS__" | sed 's/__HTTP_STATUS__//')
  BODY=$(echo "$RESPONSE" | sed '/__HTTP_STATUS__/d')
  echo -e "${YELLOW}HTTP Status:${RESET} $HTTP_STATUS"
  echo -e "${YELLOW}Response:${RESET}"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
}

echo -e "\n${BOLD}${CYAN}====  PRUEBAS: verificar_o_registrar_usuario.php  ====${RESET}"

# ─── CASO 1: Solo correo — usuario existente ─────────────────────────────────
call \
  "CASO 1 — Verificar si existe (solo email)" \
  "{\"us_email\": \"$EMAIL\"}"

# ─── CASO 2: Registro completo (usuario nuevo) ───────────────────────────────
NEW_EMAIL="test_nuevo_$(date +%s)@ejemplo.com"
call \
  "CASO 2 — Registrar usuario nuevo" \
  "{\"us_email\": \"$NEW_EMAIL\", \"us_nombres\": \"Test Usuario\", \"us_telefono\": \"787-555-9999\", \"us_clave\": \"TestPass123\"}"

# ─── CASO 3: No existe + faltan campos → debería retornar HTTP 422 ────────────
call \
  "CASO 3 — Correo no registrado sin datos extra (espera HTTP 422)" \
  "{\"us_email\": \"noexiste_$(date +%s)@ejemplo.com\"}"

separator
echo -e "\n${GREEN}Done.${RESET}\n"
