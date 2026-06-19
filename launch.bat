@echo off
title SentinelWatch
cd /d "%~dp0"
wscript //nologo "%~dp0silent.vbs"
exit