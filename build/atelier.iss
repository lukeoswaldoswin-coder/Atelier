#define AppName "Atelier 画师工坊"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
; 稳定 AppId：后续版本绝对不能再改，否则 Inno 不会识别为覆盖升级。
AppId={{7C0D2B9E-4A3F-4E8A-9C61-2D5B8F1A6E30}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Atelier
VersionInfoVersion={#AppVersion}.0
VersionInfoDescription=Atelier 画师工坊 安装程序
DefaultDirName={localappdata}\Programs\Atelier
DefaultGroupName=画师工坊
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
UsePreviousAppDir=yes
UsePreviousTasks=yes
UsePreviousGroup=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=画师工坊-Setup-{#AppVersion}
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\Atelier.exe
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesEnvironment=no
ChangesAssociations=no
AllowNoIcons=yes
MinVersion=10.0

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："

[Files]
Source: "..\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\画师工坊"; Filename: "{app}\Atelier.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\画师工坊"; Filename: "{app}\Atelier.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Atelier.exe"; Description: "启动画师工坊"; Flags: nowait postinstall skipifsilent

; 重要：绝对不要添加指向 {userappdata}\atelier 的 [UninstallDelete]。
; 用户数据库、备份和导出都位于 %APPDATA%\atelier，卸载必须保留。
