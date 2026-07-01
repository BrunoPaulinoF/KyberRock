@echo off
setlocal EnableDelayedExpansion

echo ========================================
echo  LIMPEZA FILA OMIE - KyberRock Desktop
echo ========================================
echo.

:: 1. Verificar se KyberRock Desktop esta aberto
tasklist /FI "IMAGENAME eq KyberRock Desktop.exe" 2>nul | find /I "KyberRock Desktop.exe" >nul
if %errorlevel% == 0 (
    echo [ERRO] KyberRock Desktop esta aberto!
    echo Feche o aplicativo antes de continuar.
    pause
    exit /b 1
)

:: 2. Definir caminhos
set "DB_DIR=%ProgramData%\KyberRock\data"
set "DB_FILE=%DB_DIR%\kyberrock.sqlite3"
set "TOOLS_DIR=%USERPROFILE%\tools"
set "SQLITE_EXE=%TOOLS_DIR%\sqlite3.exe"

:: Pega o diretorio onde este .bat esta
set "SCRIPT_DIR=%~dp0"
set "SQL_FILE=%SCRIPT_DIR%clear-omie-queue.sql"

:: 3. Verificar se o banco existe
if not exist "%DB_FILE%" (
    echo [ERRO] Banco de dados nao encontrado em:
    echo %DB_FILE%
    pause
    exit /b 1
)

:: 4. Verificar se o script SQL existe
if not exist "%SQL_FILE%" (
    echo [ERRO] Script SQL nao encontrado em:
    echo %SQL_FILE%
    pause
    exit /b 1
)

:: 5. Criar pasta tools e baixar sqlite3 se necessario
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"

if not exist "%SQLITE_EXE%" (
    echo [INFO] Baixando sqlite3.exe...
    powershell -Command "Invoke-WebRequest -Uri 'https://sqlite.org/2025/sqlite-tools-win-x64-3490100.zip' -OutFile '%TEMP%\sqlite.zip'" >nul 2>&1
    if errorlevel 1 (
        echo [ERRO] Falha ao baixar sqlite3. Verifique a conexao com a internet.
        pause
        exit /b 1
    )
    powershell -Command "Expand-Archive -Path '%TEMP%\sqlite.zip' -DestinationPath '%TEMP%\sqlite' -Force" >nul 2>&1
    copy "%TEMP%\sqlite\sqlite-tools-win-x64-3490100\sqlite3.exe" "%SQLITE_EXE%" >nul
    echo [OK] sqlite3.exe instalado.
) else (
    echo [OK] sqlite3.exe ja existe.
)

:: 6. Fazer backup do banco
echo [INFO] Criando backup do banco de dados...
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a%%b)
set "BACKUP_FILE=%DB_FILE%.backup-%mydate%-%mytime%"
copy "%DB_FILE%" "%BACKUP_FILE%" >nul
echo [OK] Backup salvo em:
echo %BACKUP_FILE%

:: 7. Executar a limpeza no banco SQLite
echo.
echo [INFO] Limpando jobs OMIE com chave maior que 60 caracteres...
echo.
"%SQLITE_EXE%" "%DB_FILE%" < "%SQL_FILE%"

echo.
echo ========================================
echo  LIMPEZA CONCLUIDA!
echo ========================================
echo.
echo Agora voce pode abrir o KyberRock Desktop
echo e tentar sincronizar com a OMIE novamente.
pause
