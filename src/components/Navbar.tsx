import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Wifi, WifiOff, User, Bell, Menu, SunMoon, Moon, AlertTriangle } from 'lucide-react';
import { useVehicle } from '@/contexts/VehicleContext';
import { useMobileSidebar } from './AppSidebar';
import { useSettings } from '@/contexts/SettingsContext';

const Navbar: React.FC = () => {
  const { data } = useVehicle();
  const { setOpen } = useMobileSidebar();
  const { settings, toggleTheme } = useSettings();
  const [notifOpen, setNotifOpen] = useState(false);
  const [lastReadAt, setLastReadAt] = useState<number>(Date.now());
  const notifPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!notifPanelRef.current) return;
      if (!notifPanelRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const unreadCount = useMemo(
    () =>
      (data.alerts || []).filter((a) => {
        const ts = new Date(a.timestamp as unknown as string | number | Date).getTime();
        return Number.isFinite(ts) && ts > lastReadAt;
      }).length,
    [data.alerts, lastReadAt]
  );

  const recentAlerts = useMemo(() => {
    return [...(data.alerts || [])].slice(0, 8);
  }, [data.alerts]);

  const severityStyles: Record<string, string> = {
    critical: 'text-neon-red bg-neon-red/10 border-neon-red/20',
    warning: 'text-neon-orange bg-neon-orange/10 border-neon-orange/20',
    info: 'text-neon-blue bg-neon-blue/10 border-neon-blue/20',
  };

  return (
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-xl flex items-center justify-between px-3 sm:px-4 md:px-6 sticky top-0 z-20">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        <button onClick={() => setOpen(true)} className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-muted text-muted-foreground shrink-0" aria-label="Open navigation menu">
          <Menu className="w-5 h-5" />
        </button>
        <img src="/logovt.png" alt="VTrack logo" className="w-9 h-9 sm:w-10 sm:h-10 rounded-md object-contain shrink-0" />
        <h1 className="text-sm sm:text-base font-bold text-foreground hidden sm:block truncate">
          Vehicle Tracking System
        </h1>
        <h1 className="text-sm font-bold text-foreground sm:hidden truncate">VTrack</h1>
        <span className="text-[10px] text-muted-foreground hidden lg:block"></span>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Connection status */}
        <div className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-full text-[11px] font-medium max-w-[140px] sm:max-w-none
          ${data.socketConnected ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red'}`}
        >
          {data.socketConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          <span className="hidden sm:inline truncate">{data.socketConnected ? 'Backend Online' : 'Backend Offline'}</span>
          {data.socketConnected && <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse-glow" />}
        </div>

        {/* Theme toggle */}
        <button onClick={toggleTheme} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0" aria-label="Toggle theme">
          {settings.theme === 'dark' ? <SunMoon className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Alerts bell */}
        <div className="relative" ref={notifPanelRef}>
          <button
            className="relative p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Notifications"
            onClick={() => {
              setNotifOpen((prev) => {
                const next = !prev;
                if (next) {
                  // mark all current alerts as read; next incoming alert starts from 1
                  setLastReadAt(Date.now());
                }
                return next;
              });
            }}
          >
            <Bell className={`w-4 h-4 ${unreadCount > 0 ? 'animate-pulse' : ''}`} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center font-bold">
                {Math.min(unreadCount, 99)}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-[300px] sm:w-[340px] max-h-[360px] overflow-hidden rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-xl z-50">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">Notifications</p>
                <span className="text-[10px] text-muted-foreground">{data.alerts.length} total</span>
              </div>

              <div className="max-h-[300px] overflow-y-auto p-2 space-y-1.5">
                {recentAlerts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No notifications yet</p>
                ) : (
                  recentAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`rounded-lg border px-2.5 py-2 ${severityStyles[alert.severity] || severityStyles.info}`}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-[11px] leading-snug text-foreground">{alert.message}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(alert.timestamp).toLocaleTimeString()} • {alert.severity}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="hidden sm:flex w-7 h-7 rounded-full gradient-primary items-center justify-center cursor-pointer hover:opacity-80 transition-opacity shrink-0">
          <User className="w-3.5 h-3.5 text-primary-foreground" />
        </div>
      </div>
    </header>
  );
};

export default Navbar;
