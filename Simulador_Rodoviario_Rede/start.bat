@echo off
cd /d "%~dp0"
npm run dev > simulador.out.log 2> simulador.err.log
