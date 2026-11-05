// Platform flags. The demo runs in a browser: never the desktop app (no Electron / Node), and "mobile" means a touch
// device. isWin is false so the Windows Snipping Tool integration (Electron) stays hidden. The operating system is not
// detected (the plugin only asks for isWin / isMobile / isDesktopApp).
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const touch = coarse || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
const phone = touch && Math.min(screen.width, screen.height) < 600;

export const Platform = {
    isDesktop: !touch,
    isMobile: touch,
    isDesktopApp: false,
    isMobileApp: false,
    isIosApp: false,
    isAndroidApp: false,
    isPhone: phone,
    isTablet: touch && !phone,
    isMacOS: false,
    isWin: false,
    isLinux: false,
    isSafari: false,
};
