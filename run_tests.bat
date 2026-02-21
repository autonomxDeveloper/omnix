@echo off
REM Test runner for LM Studio Chatbot
REM Usage: run_tests.bat [unit|api|integration|all]

echo ========================================
echo LM Studio Chatbot Test Suite
echo ========================================
echo.

REM Check if pytest is installed
python -c "import pytest" 2>nul
if errorlevel 1 (
    echo Installing pytest...
    pip install pytest pytest-cov
)

REM Parse argument
set TEST_TYPE=%1

if "%TEST_TYPE%"=="" set TEST_TYPE=all

if "%TEST_TYPE%"=="unit" (
    echo Running unit tests...
    python -m pytest tests/test_unit_backend.py -v
) else if "%TEST_TYPE%"=="api" (
    echo Running API endpoint tests...
    python -m pytest tests/test_api_endpoints.py -v
) else if "%TEST_TYPE%"=="integration" (
    echo Running integration tests...
    echo Note: Set environment variables to enable real service tests:
    echo   TEST_LLM=1 - Test LLM provider
    echo   TEST_TTS=1 - Test TTS server
    echo   TEST_STT=1 - Test STT server
    echo.
    python -m pytest tests/test_integration.py -v -s
) else if "%TEST_TYPE%"=="all" (
    echo Running all tests...
    python -m pytest tests/ -v --tb=short
) else if "%TEST_TYPE%"=="coverage" (
    echo Running tests with coverage report...
    python -m pytest tests/ -v --cov=. --cov-report=html --cov-report=term
    echo.
    echo Coverage report generated in htmlcov/index.html
) else (
    echo Unknown test type: %TEST_TYPE%
    echo.
    echo Usage: run_tests.bat [unit|api|integration|all|coverage]
    echo.
    echo Options:
    echo   unit        - Run unit tests only
    echo   api         - Run API endpoint tests only
    echo   integration - Run integration tests (requires services running)
    echo   all         - Run all tests
    echo   coverage    - Run all tests with coverage report
)

echo.
echo ========================================
echo Test Complete
echo ========================================