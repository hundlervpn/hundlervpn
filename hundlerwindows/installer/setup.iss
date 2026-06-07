; Hundler VPN — Inno Setup script
;
; Собирает один файл `HundlerVPN-Setup-vX.Y.Z.exe` который:
;   1) Юзер качает с GitHub Releases.
;   2) Запускает → UAC prompt.
;   3) Wizard на русском (next / next / install).
;   4) Устанавливает в `Program Files\Hundler VPN\` (или куда юзер укажет).
;   5) Создаёт shortcut в Start Menu (всегда) + на Desktop (по чекбоксу).
;   6) Регистрирует uninstaller в Add/Remove Programs.
;
; Сборка локально:
;   iscc /DAppVersion=v0.1.0 installer\setup.iss
;
; Сборка в CI: см. .github/workflows/release-windows.yml шаг
;   "Build installer (Inno Setup)".
;
; AppId: уникальный GUID — определяет идентичность установки. Никогда
; не менять на новый GUID для существующих установок, иначе старая версия
; не определит upgrade и оставит дубликат в Add/Remove Programs.

#ifndef AppVersion
  #define AppVersion "v0.0.0-dev"
#endif

#define MyAppName "Hundler VPN"
#define MyAppPublisher "Hundler"
#define MyAppURL "https://hundlervpn.xyz"
#define MyAppExeName "hundler.exe"
#define MyAppId "{B8F3D5E2-9E4A-4F8B-A1C2-3D4E5F6A7B8C}"

[Setup]
AppId={{#MyAppId}}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppVerName={#MyAppName} {#AppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\Hundler VPN
DefaultGroupName=Hundler VPN
DisableProgramGroupPage=yes
DisableWelcomePage=no
; Hundler требует админ-права для wintun TUN-адаптера, поэтому и инсталлер
; запрашиваем под админом — иначе установка в Program Files не пройдёт.
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=HundlerVPN-Setup-{#AppVersion}
SetupIconFile=..\windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; Минимальная Windows 10 1809 — wintun требует Win10+ и наш Flutter
; runner предполагает совсем свежие WinAPI.
MinVersion=10.0.17763

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; `dist\` собирается CI workflow'ом перед запуском iscc — содержит:
;   hundler.exe, *.dll, data/, bin/sing-box.exe, bin/wintun.dll, README.txt.
; Inno Setup рекурсивно упакует всё это в installer.exe.
Source: "..\dist\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Удалить {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; При удалении чистим юзер-данные (sing-box.exe, wintun.dll, sub_token,
; кэш конфигов, sessions). Это полное удаление — если юзер хочет
; сохранить настройки, пусть бэкапит %APPDATA%\com.hundlervpn вручную.
Type: filesandordirs; Name: "{userappdata}\com.hundlervpn"
