Option Explicit
Dim shell, files, base, exe
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
base = files.GetParentFolderName(WScript.ScriptFullName)
exe = files.BuildPath(base, "runtime\electron\electron.exe")
If Not files.FileExists(exe) Then
  MsgBox "Arknights Desktop Pet runtime is missing:" & vbCrLf & exe, 16, "Arknights Desktop Pet"
  WScript.Quit 1
End If
shell.CurrentDirectory = base
shell.Run Chr(34) & exe & Chr(34) & " " & Chr(34) & base & Chr(34), 0, False
