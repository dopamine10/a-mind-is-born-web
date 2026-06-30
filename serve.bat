@echo off
REM Serve "A Mind Is Born" locally with NO caching (via serve.py), so edits to modules always
REM reload fresh — ES modules are otherwise cached aggressively and mask changes.
setlocal
set PORT=8765
cd /d "%~dp0"

echo Serving %CD% (no-cache) at http://localhost:%PORT%/
echo Press Ctrl+C to stop.

REM pick whatever Python launcher is available and run the no-cache server
where py      >nul 2>nul && ( py      serve.py %PORT% & goto :eof )
where python  >nul 2>nul && ( python  serve.py %PORT% & goto :eof )
where python3 >nul 2>nul && ( python3 serve.py %PORT% & goto :eof )

echo.
echo Python was not found on PATH. Install Python, or serve this folder with any
echo static web server that disables caching, then open http://localhost:%PORT%/
pause
