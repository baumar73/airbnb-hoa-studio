on run
  set launcherPath to "/Users/demo-user/Documents/Projekt Management Owner/tools/open_airbnb_hoa.sh"
  try
    do shell script quoted form of launcherPath
  on error errMsg number errNum
    display dialog "Airbnb HOA Operations konnte nicht gestartet werden." & return & return & errMsg buttons {"OK"} default button "OK" with icon stop
  end try
end run
