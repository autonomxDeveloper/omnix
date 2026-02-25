@echo off
REM ============================================
REM Omnix - Virtual Environment Activation Script (Windows)
REM ============================================

echo =============================================
echo Omnix - Virtual Environment Activation
echo =============================================
echo.

REM Get script directory
cd /d "%~dp0"

REM Check if virtual environment exists
if exist "venv" (
    echo Activating virtual environment...
    call venv\Scripts\activate.bat
    echo Virtual environment activated!
    echo You can now run: python app.py
    echo To deactivate: deactivate
    echo.
    echo Starting command prompt with virtual environment...
    cmd.exe
) else (
    echo ERROR: Virtual environment not found!
    echo Please run: setup.bat
    echo Then try again.
    pause
    exit /b 1
)