#!/usr/bin/env bash
set -euo pipefail

USER_HOME="${HOME:-}"
if [ -z "$USER_HOME" ]; then
  echo "[ERROR] La variable \$HOME no está definida." >&2
  exit 1
fi

if [[ "${XDG_DATA_HOME:-}" == /* ]]; then
  DATA_BASE="$XDG_DATA_HOME"
else
  DATA_BASE="$USER_HOME/.local/share"
fi

if [[ "${XDG_CONFIG_HOME:-}" == /* ]]; then
  CONFIG_BASE="$XDG_CONFIG_HOME"
else
  CONFIG_BASE="$USER_HOME/.config"
fi

if [[ "${XDG_STATE_HOME:-}" == /* ]]; then
  STATE_BASE="$XDG_STATE_HOME"
else
  STATE_BASE="$USER_HOME/.local/state"
fi

if [[ "${XDG_CACHE_HOME:-}" == /* ]]; then
  CACHE_BASE="$XDG_CACHE_HOME"
else
  CACHE_BASE="$USER_HOME/.cache"
fi

LOCAL_BIN_DIR="$USER_HOME/.local/bin"
COMMAND_PATH="$LOCAL_BIN_DIR/busca-ofertas"
APPLICATIONS_DIR="$DATA_BASE/applications"
DESKTOP_FILE="$APPLICATIONS_DIR/busca-ofertas-ai.desktop"

echo "=================================================="
echo "  Busca Ofertas AI — Desinstalador del Launcher"
echo "=================================================="

# 1. Remove command wrapper and desktop entry
REMOVED_ANY=false

if [ -f "$COMMAND_PATH" ]; then
  rm -f "$COMMAND_PATH"
  echo "[OK] Comando eliminado: $COMMAND_PATH"
  REMOVED_ANY=true
fi

if [ -f "$DESKTOP_FILE" ]; then
  rm -f "$DESKTOP_FILE"
  echo "[OK] Launcher desktop eliminado: $DESKTOP_FILE"
  REMOVED_ANY=true
fi

if [ "$REMOVED_ANY" = false ]; then
  echo "[INFO] No se encontraron archivos de launcher previos para eliminar."
fi

# 2. Update desktop database if available
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

# 3. Inform about data preservation
echo ""
echo "[INFORMACIÓN DE DATOS PRESERVADOS]"
echo "La desinstalación del launcher NO elimina tus datos personales, búsquedas ni reportes."
echo "Tus datos permanecen intactos en:"
echo "  - Búsquedas y configuración: $CONFIG_BASE/busca-ofertas-ai"
echo "  - Reportes y base de datos:  $DATA_BASE/busca-ofertas-ai"
echo "  - Sesiones y logs:           $STATE_BASE/busca-ofertas-ai"
echo "  - Caché:                     $CACHE_BASE/busca-ofertas-ai"
echo "=================================================="
