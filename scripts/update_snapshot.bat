@echo off
REM 每日收盘后重建 K 线快照并推送（可加入 Windows 计划任务，16:10 运行）
cd /d %~dp0..
python scripts\build_klines.py
if errorlevel 1 exit /b 1
git add data\klines.json
git diff --staged --quiet && exit /b 0
git commit -m "data: kline snapshot"
git push origin HEAD
