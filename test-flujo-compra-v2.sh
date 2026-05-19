#!/usr/bin/env bash
# =============================================================================
# FLUJO COMPLETO DE COMPRA — v2
#   Paso 1: verificar_o_registrar   → envía OTP al correo
#   Paso 2: verificar_codigo        → autentica y devuelve token real
#   Paso 3: crear_compra            → usa token de paso 2
#   Paso 4: get_detalle_pago        → confirma el resumen
# =============================================================================

# ── Configuración ─────────────────────────────────────────────────────────────
EMAIL="calebcondor553@gmail.com"
USER_TYPE="residente"     # "residente" o "turista"
PQ_ID=26                  # Paquete ORO
AMOUNT=69.00              # Paquete ORO: $69.00 (+ $19.99 si tarjeta PVC, + $60 si acompañante)
RA_TIPO_PAC="adulto"      # "adulto" | "menor_con_acompaniante" | "mayor_con_acompaniante"
# TARJETA_PVC="oficina"   # descomenta si aplica: "oficina" | "dispensario:Nombre" | "domicilio:Dir"

# ── URLs (según user_type) ────────────────────────────────────────────────────
if [[ "$USER_TYPE" == "turista" ]]; then
  VERIFICAR_URL="https://islandmedpr.com/apiia/api/turistas/verificar_o_registrar.php"
  CODIGO_URL="https://islandmedpr.com/apiia/api/turistas/verificar_codigo.php"
  COMPRA_URL="https://islandmedpr.com/apiia/api/turistas/iniciar_pago.php"
  DETALLE_URL="https://islandmedpr.com/apiia/api/turistas/detalle_pago.php"
else
  VERIFICAR_URL="https://islandmedpr.com/apiia/api/residentes/verificar_o_registrar.php"
  CODIGO_URL="https://islandmedpr.com/apiia/api/residentes/verificar_codigo.php"
  COMPRA_URL="https://islandmedpr.com/apiia/api/residentes/iniciar_pago.php"
  DETALLE_URL="https://islandmedpr.com/apiia/api/residentes/detalle_pago.php"
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
BOLD="\033[1m"; CYAN="\033[1;36m"; GREEN="\033[1;32m"
YELLOW="\033[1;33m"; RED="\033[1;31m"; DIM="\033[2m"; RESET="\033[0m"

sep()  { echo -e "\n${CYAN}──────────────────────────────────────────────────────${RESET}"; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }
fail() { echo -e "${RED}✗ $*${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $*${RESET}"; }

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

do_get() {
  local url="$1" token="$2"
  local tmp; tmp=$(mktemp)
  local args=(-s -o "$tmp" -w "%{http_code}" -X GET "$url")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  OUT_CODE=$(curl "${args[@]}")
  OUT_BODY=$(cat "$tmp"); rm -f "$tmp"
}

jq_field() {
  echo "$1" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  for k in '$2'.split('.'): d=d[k]
  print(d)
except: print('')
" 2>/dev/null
}

pretty() { echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"; }

# =============================================================================
echo -e "\n${BOLD}${CYAN}══════════  FLUJO COMPLETO DE COMPRA (v2)  ══════════${RESET}"
echo -e "${DIM}  email     : $EMAIL${RESET}"
echo -e "${DIM}  user_type : $USER_TYPE${RESET}"
echo -e "${DIM}  pq_id     : $PQ_ID  |  amount: \$$AMOUNT${RESET}"

# ─── PASO 1: verificar_o_registrar ───────────────────────────────────────────
sep
echo -e "${BOLD}PASO 1 — verificar_o_registrar (envía OTP al correo)${RESET}\n"

do_post "$VERIFICAR_URL" "{\"us_email\":\"$EMAIL\"}"
echo -e "${YELLOW}HTTP:${RESET} $OUT_CODE"
pretty "$OUT_BODY"

CODIGO_ENVIADO=$(jq_field "$OUT_BODY" "data.codigo_enviado")
STEP1_SUCCESS=$(jq_field "$OUT_BODY" "success")

echo ""
if [[ "$STEP1_SUCCESS" == "True" || "$STEP1_SUCCESS" == "true" ]]; then
  ok "Petición aceptada"
else
  fail "La API rechazó la petición en paso 1"
  exit 1
fi

if [[ "$CODIGO_ENVIADO" == "True" || "$CODIGO_ENVIADO" == "true" || "$CODIGO_ENVIADO" == "1" ]]; then
  ok "Código OTP enviado a $EMAIL"
else
  warn "codigo_enviado = '$CODIGO_ENVIADO' — puede que ya exista sesión o la API no envió código"
fi

# ─── PASO 2: verificar_codigo (obtiene token real) ───────────────────────────
sep
echo -e "${BOLD}PASO 2 — verificar_codigo (introduce el OTP del correo)${RESET}"
echo -e "${DIM}  (correo: $EMAIL — válido 10 minutos)${RESET}\n"
read -r -p "  Código de 6 dígitos: " OTP
echo ""

if [[ ! "$OTP" =~ ^[0-9]{6}$ ]]; then
  warn "El código '$OTP' no parece de 6 dígitos — continuando de todas formas"
fi

do_post "$CODIGO_URL" "{\"us_email\":\"$EMAIL\",\"codigo\":\"$OTP\"}"
echo -e "${YELLOW}HTTP:${RESET} $OUT_CODE"
pretty "$OUT_BODY"

AUTH_TOKEN=$(jq_field "$OUT_BODY" "auth.access_token")
US_ID=$(jq_field "$OUT_BODY" "data.us_id")
US_NOMBRE=$(jq_field "$OUT_BODY" "data.us_first_name")
[[ -z "$US_NOMBRE" ]] && US_NOMBRE=$(jq_field "$OUT_BODY" "data.us_nombres")
STEP2_SUCCESS=$(jq_field "$OUT_BODY" "success")

echo ""
if [[ "$STEP2_SUCCESS" == "True" || "$STEP2_SUCCESS" == "true" ]] && [[ -n "$AUTH_TOKEN" ]]; then
  ok "Autenticado correctamente"
  echo -e "${DIM}  us_id  : $US_ID${RESET}"
  echo -e "${DIM}  nombre : $US_NOMBRE${RESET}"
  echo -e "${DIM}  token  : ${AUTH_TOKEN:0:50}...${RESET}"
else
  fail "No se obtuvo token autenticado — verifica el código OTP e inténtalo de nuevo"
  exit 1
fi

# ─── PASO 3: crear_compra ────────────────────────────────────────────────────
sep
echo -e "${BOLD}PASO 3 — crear_compra${RESET}"
echo -e "${DIM}  pq_id=$PQ_ID | us_id=$US_ID | amount=$AMOUNT | ra_tipo_pac=$RA_TIPO_PAC${RESET}\n"

COMPRA_BODY="{\"pq_id\":$PQ_ID,\"us_id\":$US_ID,\"amount\":$AMOUNT,\"ra_tipo_pac\":\"$RA_TIPO_PAC\""
if [[ -n "${TARJETA_PVC:-}" ]]; then
  COMPRA_BODY+=",\"tarjeta_pvc\":\"$TARJETA_PVC\""
fi
COMPRA_BODY+="}"

do_post "$COMPRA_URL" "$COMPRA_BODY" "$AUTH_TOKEN"
echo -e "${YELLOW}HTTP:${RESET} $OUT_CODE"
pretty "$OUT_BODY"

PAGO_TOKEN=$(jq_field "$OUT_BODY" "data.token")
URL_PAGO=$(jq_field "$OUT_BODY" "data.url_generado_pago")
CP_CODE=$(jq_field "$OUT_BODY" "data.cp_code")
STEP3_SUCCESS=$(jq_field "$OUT_BODY" "success")

echo ""
if [[ "$STEP3_SUCCESS" == "True" || "$STEP3_SUCCESS" == "true" ]] && [[ -n "$PAGO_TOKEN" ]]; then
  ok "Compra creada exitosamente"
  echo -e "${DIM}  cp_code           : $CP_CODE${RESET}"
  echo -e "${DIM}  token pago        : ${PAGO_TOKEN:0:50}...${RESET}"
  echo -e "${DIM}  url_generado_pago : $URL_PAGO${RESET}"
else
  fail "No se pudo crear la compra — revisa la respuesta arriba"
  exit 1
fi

# ─── PASO 4: get_detalle_pago ────────────────────────────────────────────────
sep
echo -e "${BOLD}PASO 4 — get_detalle_pago (resumen del pedido)${RESET}\n"

do_get "${DETALLE_URL}?token=${PAGO_TOKEN}" "$AUTH_TOKEN"
echo -e "${YELLOW}HTTP:${RESET} $OUT_CODE"
pretty "$OUT_BODY"

PLAN_NAME=$(jq_field "$OUT_BODY" "data.pg_plan_name")
PG_ESTADO=$(jq_field "$OUT_BODY" "data.pg_est_nombre")
PG_METODO=$(jq_field "$OUT_BODY" "data.pg_metodo_nombre")

echo ""
ok "Resumen obtenido"
echo -e "${BOLD}  Paquete : $PLAN_NAME${RESET}"
echo -e "${BOLD}  Estado  : $PG_ESTADO${RESET}"
echo -e "${BOLD}  Método  : $PG_METODO${RESET}"
echo -e "${BOLD}  Monto   : \$$AMOUNT${RESET}"

# ─── Enlace de pago ──────────────────────────────────────────────────────────
sep
echo -e "\n${BOLD}${GREEN}  ✓ FLUJO COMPLETADO${RESET}"
echo -e "${BOLD}  Enlace de pago:${RESET}"
echo -e "${BOLD}${CYAN}  https://islandmedpr.com/enlace/index.php?u=${URL_PAGO}${RESET}\n"
