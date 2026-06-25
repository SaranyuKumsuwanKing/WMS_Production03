@echo off
REM Build the debug APK from the command line.
REM Uses Android Studio's bundled JDK and a short TEMP dir (the JDK's NIO
REM selector uses an AF_UNIX socket whose path must stay under ~108 chars).

set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
if not exist "C:\wtmp" mkdir "C:\wtmp"
set "TEMP=C:\wtmp"
set "TMP=C:\wtmp"

cd /d "%~dp0"
call gradlew.bat assembleDebug %*

echo.
echo APK: app\build\outputs\apk\debug\app-debug.apk
