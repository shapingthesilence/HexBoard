@echo off
setlocal

cd /d "%~dp0"
set "GUI_SCRIPT=%~dp0scripts\hexboard_backup_gui.py"

where py >nul 2>&1
if not errorlevel 1 (
  py -3 "%GUI_SCRIPT%"
  goto handle_exit
)

where python >nul 2>&1
if not errorlevel 1 (
  python "%GUI_SCRIPT%"
  goto handle_exit
)

where python3 >nul 2>&1
if not errorlevel 1 (
  python3 "%GUI_SCRIPT%"
  goto handle_exit
)

echo Python 3 was not found.
echo.
echo Install Python 3 from https://www.python.org/downloads/
echo Then install pyserial with one of these:
echo   py -m pip install pyserial
echo   python -m pip install pyserial
echo.
pause
exit /b 1

:handle_exit
if errorlevel 1 (
  echo.
  echo The HexBoard Backup GUI exited with an error.
  echo If pyserial is missing, install it with one of these:
  echo   py -m pip install pyserial
  echo   python -m pip install pyserial
  echo.
  pause
)

endlocal
