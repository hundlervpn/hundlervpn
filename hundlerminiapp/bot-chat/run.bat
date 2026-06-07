@echo off
rem Wrapper that launches the chat-only bot from the local venv.
rem Only used during local development; on the VPS the systemd unit
rem invokes the venv's python directly.
"%~dp0venv\Scripts\python.exe" "%~dp0main.py"
