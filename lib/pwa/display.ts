export function isStandaloneDisplay(win: Window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return (
    win.matchMedia("(display-mode: standalone)").matches ||
    win.matchMedia("(display-mode: window-controls-overlay)").matches ||
    Boolean(nav.standalone)
  );
}

export function isIosDevice(win: Window): boolean {
  return /iPad|iPhone|iPod/.test(win.navigator.userAgent) && !("MSStream" in win);
}

export function shouldShowInstallHelp(ready: boolean, standalone: boolean): boolean {
  return ready && !standalone;
}
