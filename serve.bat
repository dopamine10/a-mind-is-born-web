@echo off
REM Serve "A Mind Is Born" locally. ES modules need http(s), not file://, so we run a static server.
setlocal
set PORT=8765
cd /d "%~dp0"

echo Serving %CD% at http://localhost:%PORT%/
echo Press Ctrl+C to stop.

REM open the page in the default browser (slight delay so the server is up)
start "" cmd /c "timeout /t 1 >nul & start http://localhost:%PORT%/index.html"

REM pick whatever Python launcher is available
where py >nul 2>nul && (py -m http.server %PORT% & goto :eof)
where python >nul 2>nul && (python -m http.server %PORT% & goto :eof)
where python3 >nul 2>nul && (python3 -m http.server %PORT% & goto :eof)

echo.
echo Python was not found on PATH. Install Python, or serve this folder with any
echo static web server (e.g.  npx serve  ), then open http://localhost:%PORT%/
pause
