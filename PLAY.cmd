@echo off
setlocal
title Flower Garden

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\play-flower-garden.ps1" %*
set "FLOWER_GARDEN_EXIT=%ERRORLEVEL%"

if not "%FLOWER_GARDEN_EXIT%"=="0" (
  echo.
  echo Flower Garden could not start. See the message above.
)

exit /b %FLOWER_GARDEN_EXIT%
