@echo off
title GoverHub yerel demo - YEDEKLER
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo.ps1" yedek-listele
echo.
pause
