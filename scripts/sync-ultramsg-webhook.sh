#!/bin/sh
# Registra en la instancia de UltraMsg el webhook publico de la API
# (ULTRAMSG_WEBHOOK_URL en el .env).
#
# Por que: si UltraMsg tiene la URL vieja, postea a un sitio que ya no existe
# y los mensajes del paciente se pierden SIN ningun error visible.
#
# Corre como servicio de un solo disparo en docker compose:
#   docker compose logs webhook-sync

set -u

WEBHOOK="${ULTRAMSG_WEBHOOK_URL:-}"
if [ -z "$WEBHOOK" ]; then
  echo "[webhook-sync] falta ULTRAMSG_WEBHOOK_URL en el .env" >&2
  exit 1
fi

try=1
while [ "$try" -le 5 ]; do
  RESP=$(curl -s -X POST \
    "https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/instance/settings" \
    --data-urlencode "token=${ULTRAMSG_TOKEN}" \
    --data-urlencode "webhook_url=${WEBHOOK}" \
    --data-urlencode "webhook_message_received=true")

  case "$RESP" in
    *error*)
      echo "[webhook-sync] intento $try fallo: $RESP"
      try=$((try + 1))
      sleep 3
      ;;
    *)
      echo "[webhook-sync] webhook registrado: $WEBHOOK"
      exit 0
      ;;
  esac
done

echo "[webhook-sync] no se pudo registrar el webhook" >&2
exit 1
