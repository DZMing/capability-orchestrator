@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PLUGIN_ROOT=%%~fI"
if not defined CLAUDE_USER_DIR (
  for %%I in ("%PLUGIN_ROOT%\..\..\..") do set "CLAUDE_USER_DIR=%%~fI"
)
if not defined CLAUDE_PLUGIN_DATA (
  set "CLAUDE_PLUGIN_DATA=%PLUGIN_ROOT%\data"
)
node "%SCRIPT_DIR%route-matcher.cjs" %*
