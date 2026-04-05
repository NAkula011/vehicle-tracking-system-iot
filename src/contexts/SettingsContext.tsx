import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface AppSettings {
  notifications: {
    overspeed: boolean;
    geofence: boolean;
    idle: boolean;
  };
  connection: {
    autoReconnect: boolean;
    secureMode: boolean;
  };
  tracking: {
    deviceFilter: string;
    speedLimit: number;
    idleMinutes: number;
    geofenceCenterLat: number;
    geofenceCenterLng: number;
    geofenceRadiusMeters: number;
  };
  theme?: 'light' | 'dark';
}

const STORAGE_KEY = 'fleet-guardian-settings';

export const defaultSettings: AppSettings = {
  notifications: {
    overspeed: true,
    geofence: true,
    idle: true,
  },
  connection: {
    autoReconnect: true,
    secureMode: false,
  },
  tracking: {
    deviceFilter: 'ALL',
    speedLimit: 80,
    idleMinutes: 15,
    geofenceCenterLat: 28.6139,
    geofenceCenterLng: 77.209,
    geofenceRadiusMeters: 750,
  },
  theme: 'dark',
};

type SettingsContextValue = {
  settings: AppSettings;
  updateNotification: (key: keyof AppSettings['notifications'], value: boolean) => void;
  updateConnection: (key: keyof AppSettings['connection'], value: boolean) => void;
  updateTracking: (key: Exclude<keyof AppSettings['tracking'], 'deviceFilter'>, value: number) => void;
  updateDeviceFilter: (value: string) => void;
  resetSettings: () => void;
  exportSettings: () => string;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const loadSettings = (): AppSettings => {
  if (typeof window === 'undefined') {
    return defaultSettings;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return defaultSettings;
    }

    const parsed = JSON.parse(stored) as Partial<AppSettings>;
    return {
      notifications: { ...defaultSettings.notifications, ...parsed.notifications },
      connection: { ...defaultSettings.connection, ...parsed.connection },
      tracking: { ...defaultSettings.tracking, ...parsed.tracking },
      theme: parsed.theme ?? defaultSettings.theme,
    };
  } catch {
    return defaultSettings;
  }
};

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  // Apply theme class to document root
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const theme = settings.theme || 'dark';
    const root = window.document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [settings.theme]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const updateNotification = useCallback((key: keyof AppSettings['notifications'], value: boolean) => {
    setSettings(prev => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }));
  }, []);

  const updateConnection = useCallback((key: keyof AppSettings['connection'], value: boolean) => {
    setSettings(prev => ({
      ...prev,
      connection: { ...prev.connection, [key]: value },
    }));
  }, []);

  const updateTracking = useCallback((key: Exclude<keyof AppSettings['tracking'], 'deviceFilter'>, value: number) => {
    setSettings(prev => ({
      ...prev,
      tracking: { ...prev.tracking, [key]: value },
    }));
  }, []);

  const updateDeviceFilter = useCallback((value: string) => {
    setSettings(prev => ({
      ...prev,
      tracking: { ...prev.tracking, deviceFilter: value.trim() || 'ALL' },
    }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const setTheme = useCallback((theme: 'light' | 'dark') => {
    setSettings(prev => ({ ...prev, theme }));
  }, []);

  const toggleTheme = useCallback(() => {
    setSettings(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }));
  }, []);

  const exportSettings = useCallback(() => JSON.stringify(settings, null, 2), [settings]);

  const value = useMemo(
    () => ({ settings, updateNotification, updateConnection, updateTracking, updateDeviceFilter, resetSettings, exportSettings, setTheme, toggleTheme }),
    [settings, updateNotification, updateConnection, updateTracking, updateDeviceFilter, resetSettings, exportSettings, setTheme, toggleTheme]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be within SettingsProvider');
  return ctx;
};