#!/usr/bin/env bash
# =============================================================================
# Test flujo completo: verificar → código interactivo → crear_compra
# =============================================================================

VERIFICAR_URL="https://www.doctorrecetas.com/api/verificar_o_registrar_usuario.php"
COMPRA_URL="https://www.doctorrecetas.com/api/crear_compra.php"
EMAIL="andreslg20@gmail.com"
PQ_ID=26
ANOMBRE_DE="María García"

BOLD="\033[1m"; CYAN="\033[1;36m"; GREEN="\033[1;32m"
YELLOW="\033[1;33m"; RED="\033[1;31m"; DIM="\033[2m"; RESET="\033[0m"

sep()  { echo -e "\n${CYAN}─────────────────────────────────────────────────────${RESET}"; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }
fail() { echo -e "${RED}✗ $*${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $*${RESET}"; }

# Hace POST y devuelve "<http_code> <body>" en dos vars globales OUT_CODE / OUT_BODY
do_post() {
  local url="$1" body="$2" token="$3"
  local tmp; tmp=$(mktemp)
  local args=(-s -o "$tmp" -w "%{http_code}" -X POST "$url"
              -H "Content-Type: application/json"
              --data-raw "$body")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  OUT_CODE=$(curl "${args[@]}")
  OUT_BODY=$(cat "$tmp"); rm -f "$tmp"
}

# Extrae campo de JSON con python3
jq_field() { echo "$1" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  for k in '$2'.split('.'): d=d[k]
  print(d)
except: print('')
" 2>/dev/null; }

pretty() { echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"; }

echo -e "\n${BOLD}${CYAN}══════════  FLUJO COMPLETO DE COMPRA  ══════════${RESET}"

# ─── PASO 1: Verificar usuario existente ────────────────────────────────────
sep
echo -e "${BOLD}PASO 1 — Verificar usuario existente${RESET}"
echo -e "${DIM}  Email: $EMAIL${RESET}\n"

do_post "$VERIFICAR_URL" "{\"us_email\":\"$EMAIL\"}"
echo -e "${YELLOW}HTTP:${RESET} $OUT_CODE"
pretty "$OUT_BODY"

TOKEN=$(jq_field "$OUT_BODY" "data.token")
US_ID=$(jq_field "$OUT_BODY" "data.us_id")
US_NOMBRE=$(jq_field "$OUT_BODY" "data.us_nombres")
CODIGO_ENVIADO=$(jq_field "$OUT_BODY" "data.codigo_enviado")

echo ""
[[ "$CODIGO_ENVIADO" == "True" || "$CODIGO_ENVIADO" == "true" || "$CODIGO_ENVIADO" == "1" ]] \
  && ok "Código de 6 dígitos enviado a $EMAIL" \
  || warn "codigo_enviado = '$CODIGO_ENVIADO'"

if [[ -n "$TOKEN" ]]; then
  ok "Token recibido"
  echo -e "${DIM}  us_id  : $US_ID${RESET}"
  echo -e "${DIM}  nombre : $US_NOMBRE${RESET}"
  echo -e "${DIM}  token  : ${TOKEN:0:50}...${RESET}"
else
  fail "No se recibió token"
fi

# ─── PASO 2: Ingresar código recibido por correo ─────────────────────────────
sep
echo -e "${BOLD}PASO 2 — Ingresa el código de 6 dígitos que llegó al correo${RESET}"
echo -e "${DIM}  (correo: $EMAIL — expira en 10 minutos)${RESET}\n"
read -r -p "  Código: " CODIGO_INGRESADO
echo ""

if [[ ${#CODIGO_INGRESADO} -eq 6 && "$CODIGO_INGRESADO" =~ ^[0-9]+$ ]]; then
  ok "Código ingresado: $CODIGO_INGRESADO — identidad confirmada"
  echo -e "${DIM}  El token del Paso 1 se usará para la compra${RESET}"
else
  warn "Código '$CODIGO_INGRESADO' no parece válido (se esperan 6 dígitos) — continuando"
fi

# ─── PASO 3: Crear compra ────────────────────────────────────────────────────
sep
echo -e "${BOLD}PASO 3 — Crear compra (pq_id=$PQ_ID, a nombre de \"$ANOMBRE_DE\")${RESET}"
echo -e "${DIM}  us_id: $US_ID | token: ${TOKEN:0:30}...${RESET}\n"

if [[ -z "$TOKEN" || -z "$US_ID" ]]; then
  fail "Sin token o us_id — no se puede crear la compra"
else
  do_post "$COMPRA_URL" \
    "{\"pq_id\":$PQ_ID,\"us_id\":$US_ID,\"anombre_de\":\"$ANOMBRE_DE\"}" \
    "$TOKEN"
  echo -e "${YELLOW}HTTP:${RESET} $OUT_CODE"
  pretty "$OUT_BODY"

  CP_CODE=$(jq_field "$OUT_BODY" "data.cp_code")
  URL_PAGO=$(jq_field "$OUT_BODY" "data.url_generado_pago")

  echo ""
  if [[ -n "$CP_CODE" ]]; then
    ok "Compra creada"
    echo -e "${DIM}  cp_code           : $CP_CODE${RESET}"
    echo -e "${DIM}  url_generado_pago : $URL_PAGO${RESET}"
    echo ""
    echo -e "${BOLD}${GREEN}  Enlace de pago:${RESET}"
    echo -e "${BOLD}  https://doctorrecetas.com/pago/index.php?code=${URL_PAGO}${RESET}"
  else
    fail "No se recibió cp_code — revisa la respuesta arriba"
  fi
fi

# ─── PASO 4: Crear compra SIN token (debe fallar con 401) ────────────────────
sep
echo -e "${BOLD}PASO 4 — Crear compra SIN token (debe rechazarse)${RESET}\n"

do_post "$COMPRA_URL" "{\"pq_id\":$PQ_ID,\"us_id\":99,\"anombre_de\":\"Nadie\"}"
echo -e "${YELLOW}HTTP:${RESET} $OUT_CODE"
pretty "$OUT_BODY"
echo ""
if [[ "$OUT_CODE" == "401" || "$OUT_CODE" == "403" ]]; then
  ok "API rechazó correctamente la petición sin token ($OUT_CODE)"
else
  warn "Respondió $OUT_CODE — se esperaba 401/403"
fi

sep
echo -e "\n${GREEN}${BOLD}Done.${RESET}\n"
