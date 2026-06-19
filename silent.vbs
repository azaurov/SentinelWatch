Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = scriptDir

' Use cmd.exe to resolve npm.cmd via PATH; the script directory becomes cwd.
shell.Run "cmd /c npm start", 0, False
