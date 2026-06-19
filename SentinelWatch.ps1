$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
Start-Process cmd.exe -ArgumentList '/c npm start' -WorkingDirectory $here
