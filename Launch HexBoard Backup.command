#!/bin/zsh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUI_SCRIPT="$SCRIPT_DIR/scripts/hexboard_backup_gui.py"

run_gui() {
  local python_cmd="$1"
  "$python_cmd" "$GUI_SCRIPT"
  return $?
}

cd "$SCRIPT_DIR" || exit 1

if command -v python3 >/dev/null 2>&1; then
  run_gui python3
  status=$?
elif command -v python >/dev/null 2>&1; then
  run_gui python
  status=$?
else
  echo "Python 3 was not found."
  echo
  echo "Install Python 3 from https://www.python.org/downloads/"
  echo "Then install pyserial with:"
  echo "  python3 -m pip install --user pyserial"
  echo
  read "?Press Return to close..."
  exit 1
fi

if [ "$status" -ne 0 ]; then
  echo
  echo "The HexBoard Backup GUI exited with an error."
  echo "If pyserial is missing, install it with:"
  echo "  python3 -m pip install --user pyserial"
  echo
  read "?Press Return to close..."
fi

exit "$status"
