#!/usr/bin/env bash
# =============================================================================
# Test: Flujo completo de compra
#   1) Verificar usuario existente  → obtener token
#   2) Verificar usuario nuevo      → registrar → obtener token
#   3) Crear compra con token       → cp_code + url_generado_pago
#   4) Intentar crear compra sin token → debe fallar con AUTH error
# =============================================================================

VERIFICAR_URL="https://www.doctorrecetas.com/api/verificar_o_registrar_usuario.php"
COMPRA_URL="https://www.doctorrecetas.com/api/crear_compra.php"

EMAIL_EXISTENTE="andreslg20@gmail.com"
EMAIL_NUEVO="test_compra_$(date +%s)@ejemplo.com"
PQ_ID=1
ANOMBRE_DE="María García"

BOLD="\033[1m"
CYAN="\033[1;36m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
DIM="\033[2m"
RESET="\033[0m"

sep() { echo -e "\n${CYAN}─────────────────────────────────────────────────────${RESET}"; }

post() {
  local url="$1" body="$2" token="$3"
  local auth_header=""
  [[ -n "$token" ]] && auth_header='-H "Authorization: Bearer '"$token"'"'
  RESPONSE=$(eval curl -s -w "\n__STATUS__%{http_code}" \
    -X POST "\"$url\"" \
    -H "\"Content-Type: application/json\"" \
    $auth_header \
    -d "\"$body\"")
  HTTP_CODE=$(echo "$RESPONSE" | grep "__STATUS__" | sed 's/__STATUS__//')
  BODY=$(echo "$RESPONSE" | sed '/__STATUS__/d')
  echo "$HTTP_CODE|$BODY"
}

extract() {
  # extract value of a JSON key using python3
  echo "$1" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    keys = '$2'.split('.')
    v = d
    for k in keys: v = v[k]
    print(v)
except: print('')
" 2>/dev/null
}

print_response() {
  local label="$1" code="$2" body="$3"
  echo -e "${YELLOW}HTTP:${RESET} $code"
  echo -e "${YELLOW}Respuesta:${RESET}"
  echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
}

echo -e "\n${BOLD}${CYAN}══════  FLUJO COMPLETO DE COMPRA  ══════${RESET}"

# ─── PASO 1: Verificar usuario existente ─────────────────────────────────────
sep
echo -e "${BOLD}PASO 1 — Verificar usuario existente (obtener token)${RESET}"
echo -e "${DIM}Email: $EMAIL_EXISTENTE${RESET}\n"

RES=$(post "$VERIFICAR_URL" "{\"us_email\":\"$EMAIL_EXISTENTE\"}")
CODE=$(echo "$RES" | cut -d'|' -f1)
BODY=$(echo "$RES" | cut -d'|' -f2-)
print_response "Verificar existente" "$CODE" "$BODY"

TOKEN=$(extract "$BODY" "data.token")
US_ID=$(extract "$BODY" "data.us_id")
US_NOMBRE=$(extract "$BODY" "data.us_nombres")
CODIGO_ENVIADO=$(extract "$BODY" "data.codigo_enviado")

if [[ -n "$TOKEN" ]]; then
  echo -e "\n${GREEN}✓ Token obtenido${RESET}"
  echo -e "${DIM}  us_id   : $US_ID${RESET}"
  echo -e "${DIM}  nombre  : $US_NOMBRE${RESET}"
  echo -e "${DIM}  código enviado al correo: $CODIGO_ENVIADO${RESET}"
  echo -e "${DIM}  token   : ${TOKEN:0:40}...${RESET}"
else
  echo -e "\n${RED}✗ No se recibió token — revisa la API${RESET}"
fi

# ─── PASO 2: Registrar usuario nuevo (flujo alternativo) ─────────────────────
sep
echo -e "${BOLD}PASO 2 — Registrar usuario nuevo (flujo alternativo)${RESET}"
echo -e "${DIM}Email: $EMAIL_NUEVO${RESET}\n"

RES2=$(post "$VERIFICAR_URL" "{\"us_email\":\"$EMAIL_NUEVO\",\"us_nombres\":\"Test Compra\",\"us_telefono\":\"787-555-0001\",\"us_clave\":\"TestPass123\"}")
CODE2=$(echo "$RES2" | cut -d'|' -f1)
BODY2=$(echo "$RES2" | cut -d'|' -f2-)
print_response "Registrar nuevo" "$CODE2" "$BODY2"

TOKEN2=$(extract "$BODY2" "data.token")
US_ID2=$(extract "$BODY2" "data.us_id")

if [[ -n "$TOKEN2" ]]; then
  echo -e "\n${GREEN}✓ Usuario registrado y token obtenido${RESET}"
  echo -e "${DIM}  us_id : $US_ID2${RESET}"
  echo -e "${DIM}  token : ${TOKEN2:0:40}...${RESET}"
else
  echo -e "\n${RED}✗ No se recibió token en registro${RESET}"
fi

# ─── PASO 3: Crear compra con token del usuario existente ─────────────────────
sep
echo -e "${BOLD}PASO 3 — Crear compra (con token, a nombre de \"$ANOMBRE_DE\")${RESET}"
echo -e "${DIM}us_id: $US_ID | pq_id: $PQ_ID${RESET}\n"

if [[ -z "$TOKEN" || -z "$US_ID" ]]; then
  echo -e "${RED}✗ Saltando — no hay token/us_id del Paso 1${RESET}"
else
  RES3=$(post "$COMPRA_URL" "{\"pq_id\":$PQ_ID,\"us_id\":$US_ID,\"anombre_de\":\"$ANOMBRE_DE\"}" "$TOKEN")
  CODE3=$(echo "$RES3" | cut -d'|' -f1)
  BODY3=$(echo "$RES3" | cut -d'|' -f2-)
  print_response "Crear compra" "$CODE3" "$BODY3"

  CP_CODE=$(extract "$BODY3" "data.cp_code")
  URL_PAGO=$(extract "$BODY3" "data.url_generado_pago")

  if [[ -n "$CP_CODE" ]]; then
    echo -e "\n${GREEN}✓ Compra creada exitosamente${RESET}"
    echo -e "${DIM}  cp_code          : $CP_CODE${RESET}"
    echo -e "${DIM}  url_generado_pago: $URL_PAGO${RESET}"
  else
    echo -e "\n${RED}✗ No se recibió cp_code${RESET}"
  fi
fi

# ─── PASO 4: Crear compra SIN token (debe fallar) ────────────────────────────
sep
echo -e "${BOLD}PASO 4 — Crear compra SIN token (debe fallar con error de auth)${RESET}\n"

RES4=$(post "$COMPRA_URL" "{\"pq_id\":$PQ_ID,\"us_id\":99,\"anombre_de\":\"Nadie\"}")
CODE4=$(echo "$RES4" | cut -d'|' -f1)
BODY4=$(echo "$RES4" | cut -d'|' -f2-)
print_response "Crear sin token" "$CODE4" "$BODY4"

if [[ "$CODE4" == "401" || "$CODE4" == "403" || "$CODE4" == "422" ]]; then
  echo -e "\n${GREEN}✓ API rechazó correctamente la petición sin token${RESET}"
else
  echo -e "\n${YELLOW}⚠ La API respondió $CODE4 — verifica si requiere autenticación${RESET}"
fi

sep
echo -e "\n${GREEN}${BOLD}Done.${RESET}\n"
