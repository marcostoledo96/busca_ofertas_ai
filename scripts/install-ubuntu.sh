#!/usr/bin/env bash
set -euo pipefail

# 1. Resolve repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=================================================="
echo "  Busca Ofertas AI — Instalador de Usuario Ubuntu"
echo "=================================================="

# 2. Check Operating System
OS_NAME="$(uname -s)"
if [ "$OS_NAME" != "Linux" ]; then
  echo "[ERROR] Este instalador está diseñado para Linux/Ubuntu. Sistema detectado: $OS_NAME" >&2
  exit 1
fi

# 3. Check Node.js runtime
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no está instalado o no se encuentra en \$PATH." >&2
  echo "Instalá Node.js >= 22.0.0 antes de continuar." >&2
  exit 1
fi

NODE_VERSION_RAW="$(node -v 2>/dev/null || echo '')"
NODE_MAJOR=$(echo "$NODE_VERSION_RAW" | sed -E 's/^v([0-9]+).*/\1/' || echo '0')

if [ -z "$NODE_MAJOR" ] || ! [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
  echo "[ERROR] Node.js >= 22.0.0 es requerido. Versión detectada: ${NODE_VERSION_RAW:-desconocida}" >&2
  exit 1
fi

# 4. Check application build
CLI_DIST_BIN="$REPO_ROOT/apps/cli/dist/bin.js"
if [ ! -f "$CLI_DIST_BIN" ]; then
  echo "[ERROR] Build no encontrado. Ejecutá: pnpm build" >&2
  exit 1
fi

# 5. Resolve XDG Base Directories with absolute path validation
USER_HOME="${HOME:-}"
if [ -z "$USER_HOME" ]; then
  echo "[ERROR] La variable \$HOME no está definida." >&2
  exit 1
fi

if [[ "${XDG_CONFIG_HOME:-}" == /* ]]; then
  CONFIG_BASE="$XDG_CONFIG_HOME"
else
  CONFIG_BASE="$USER_HOME/.config"
fi

if [[ "${XDG_DATA_HOME:-}" == /* ]]; then
  DATA_BASE="$XDG_DATA_HOME"
else
  DATA_BASE="$USER_HOME/.local/share"
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

APP_CONFIG_ROOT="$CONFIG_BASE/busca-ofertas-ai"
APP_SEARCHES_DIR="$APP_CONFIG_ROOT/searches"
APP_DATA_ROOT="$DATA_BASE/busca-ofertas-ai"
APP_REPORTS_DIR="$APP_DATA_ROOT/reports"
APP_STATE_ROOT="$STATE_BASE/busca-ofertas-ai"
APP_SESSIONS_DIR="$APP_STATE_ROOT/sessions"
APP_LOGS_DIR="$APP_STATE_ROOT/logs"
APP_CACHE_ROOT="$CACHE_BASE/busca-ofertas-ai"

# 6. Create application directories with restrictive 0700 permissions
mkdir -p -m 0700 "$APP_CONFIG_ROOT" "$APP_SEARCHES_DIR" "$APP_DATA_ROOT" "$APP_REPORTS_DIR" "$APP_STATE_ROOT" "$APP_SESSIONS_DIR" "$APP_LOGS_DIR" "$APP_CACHE_ROOT"
chmod 0700 "$APP_CONFIG_ROOT" "$APP_SEARCHES_DIR" "$APP_DATA_ROOT" "$APP_REPORTS_DIR" "$APP_STATE_ROOT" "$APP_SESSIONS_DIR" "$APP_LOGS_DIR" "$APP_CACHE_ROOT"

# 7. Install local user command wrapper (~/.local/bin/busca-ofertas)
LOCAL_BIN_DIR="$USER_HOME/.local/bin"
mkdir -p "$LOCAL_BIN_DIR"
COMMAND_PATH="$LOCAL_BIN_DIR/busca-ofertas"

cat <<WRAPPER_EOF > "$COMMAND_PATH"
#!/usr/bin/env bash
set -euo pipefail
exec node "$CLI_DIST_BIN" "\$@"
WRAPPER_EOF

chmod 0755 "$COMMAND_PATH"

# 8. Check \$PATH integration
PATH_WARNING=false
case ":$PATH:" in
  *":$LOCAL_BIN_DIR:"*) ;;
  *)
    PATH_WARNING=true
    ;;
esac

# 9. Create and install desktop launcher
APPLICATIONS_DIR="$DATA_BASE/applications"
mkdir -p "$APPLICATIONS_DIR"
DESKTOP_FILE="$APPLICATIONS_DIR/busca-ofertas-ai.desktop"

cat <<DESKTOP_EOF > "$DESKTOP_FILE"
[Desktop Entry]
Type=Application
Version=1.5
Name=Busca Ofertas AI
Comment=Buscar y revisar ofertas locales
Exec="$COMMAND_PATH"
TryExec=$COMMAND_PATH
Terminal=true
Icon=utilities-terminal
Categories=Utility;
DESKTOP_EOF

chmod 0644 "$DESKTOP_FILE"

# 10. Validate desktop file if validator is present
if command -v desktop-file-validate >/dev/null 2>&1; then
  if ! desktop-file-validate "$DESKTOP_FILE"; then
    echo "[ERROR] Falló la validación formal de desktop-file-validate." >&2
    exit 1
  fi
  VALIDATION_STATUS="Validado con desktop-file-validate"
else
  VALIDATION_STATUS="desktop-file-validate no disponible (validación interna OK)"
fi

# 11. Update desktop database if available
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

echo ""
echo "[OK] Instalación completada exitosamente:"
echo "  - Comando local: $COMMAND_PATH"
echo "  - Launcher desktop: $DESKTOP_FILE ($VALIDATION_STATUS)"
echo "  - Directorios privados (0700):"
echo "      Config: $APP_CONFIG_ROOT"
echo "      Data:   $APP_DATA_ROOT"
echo "      State:  $APP_STATE_ROOT"
echo "      Cache:  $APP_CACHE_ROOT"
echo ""

if [ "$PATH_WARNING" = true ]; then
  echo "[ADVERTENCIA] $LOCAL_BIN_DIR no se encuentra actualmente en tu \$PATH."
  echo "Para ejecutar 'busca-ofertas' directamente desde cualquier terminal, agregá la siguiente línea a tu ~/.bashrc o ~/.profile:"
  echo ""
  echo "  export PATH=\"$LOCAL_BIN_DIR:\$PATH\""
  echo ""
fi

echo "Nota: Este launcher ejecuta el build del repositorio en '$REPO_ROOT'. Si movés o eliminás el repositorio, deberás reinstalar el launcher."
echo ""
echo "Para comenzar, ejecutá:"
echo "  busca-ofertas"
echo "=================================================="
