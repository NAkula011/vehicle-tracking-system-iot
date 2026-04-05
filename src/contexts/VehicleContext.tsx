import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useSettings } from './SettingsContext';
import { useAuth } from './AuthContext';
import { toast } from '@/components/ui/sonner';

export interface VehicleData {
  vehicleId: string;
  speed: number;
  latitude: number;
  longitude: number;
  lastUpdated: Date;
  gsmSignal: number; // 0-5
  engineOn: boolean;
  locked: boolean;
  isOnline: boolean;
  socketConnected: boolean;
  deviceConnected: boolean;
  deviceLastSeen: Date | null;
  routeHistory: [number, number][];
  alerts: Alert[];
  speedHistory: { time: string; speed: number }[];
}

export interface Alert {
  id: string;
  type: 'overspeed' | 'idle' | 'geofence' | 'low-signal' | 'engine';
  message: string;
  timestamp: Date;
  severity: 'warning' | 'critical' | 'info';
}

const initialRoute: [number, number][] = [
  [28.6139, 77.2090],
  [28.6145, 77.2095],
  [28.6150, 77.2100],
  [28.6155, 77.2108],
  [28.6160, 77.2115],
];

const defaultData: VehicleData = {
  vehicleId: 'No device connected',
  speed: 0,
  latitude: 0,
  longitude: 0,
  lastUpdated: new Date(0),
  gsmSignal: 0,
  engineOn: false,
  locked: true,
  isOnline: false,
  socketConnected: false,
  deviceConnected: false,
  deviceLastSeen: null,
  routeHistory: [],
  alerts: [],
  speedHistory: Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    speed: 0,
  })),
};

interface VehicleContextType {
  data: VehicleData;
  availableDevices: string[];
  onlineDevices: string[];
  selectedDeviceId: string;
  setSelectedDeviceId: (deviceId: string) => void;
  toggleEngine: () => void;
  toggleLock: () => void;
}

type LocationPayload = {
  deviceId?: string;
  vehicleId?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  gsmSignal?: number;
  engineOn?: boolean;
  locked?: boolean;
  raw?: string;
  topic?: string;
  timestamp?: string;
};

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000';
const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL ?? 'http://localhost:3000';
const DEVICE_TIMEOUT_MS = 4000;

const VehicleContext = createContext<VehicleContextType | null>(null);

export const useVehicle = () => {
  const ctx = useContext(VehicleContext);
  if (!ctx) throw new Error('useVehicle must be within VehicleProvider');
  return ctx;
};

const parseLocationPayload = (payload: unknown): LocationPayload | null => {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();

    try {
      const parsed = JSON.parse(trimmed) as Partial<LocationPayload>;
      if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
        return parsed as LocationPayload;
      }
    } catch {
      // fall through to comma-separated parsing
    }

    const [latitudeText, longitudeText, speedText] = trimmed.split(',').map(part => part.trim());
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const speed = speedText ? Number(speedText) : undefined;

    return {
      latitude,
      longitude,
      ...(Number.isFinite(speed ?? Number.NaN) ? { speed } : {}),
      raw: trimmed,
    };
  }

  if (payload && typeof payload === 'object') {
    const candidate = payload as Partial<LocationPayload>;
    if (typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number') {
      return candidate as LocationPayload;
    }
  }

  return null;
};

export const VehicleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings, updateDeviceFilter } = useSettings();
  const { session } = useAuth();
  const [data, setData] = useState<VehicleData>(defaultData);
  const [availableDevices, setAvailableDevices] = useState<string[]>([]);
  const [onlineDevices, setOnlineDevices] = useState<string[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const deviceOfflineTimerRef = useRef<number | null>(null);
  const selectedDeviceFilterRef = useRef<string>('ALL');
  const autoReconnectRef = useRef<boolean>(settings.connection.autoReconnect);
  const settingsRef = useRef(settings);

  const effectiveSocketUrl = useMemo(() => {
    if (!settings.connection.secureMode) {
      return SOCKET_URL;
    }

    try {
      const url = new URL(SOCKET_URL);
      if (url.protocol === 'http:') url.protocol = 'https:';
      if (url.protocol === 'ws:') url.protocol = 'wss:';
      return url.toString();
    } catch {
      return SOCKET_URL;
    }
  }, [settings.connection.secureMode]);

  const markDeviceOffline = useCallback(() => {
    setData(prev =>
      prev.deviceConnected
        ? {
            ...prev,
            deviceConnected: false,
            isOnline: false,
            vehicleId: 'No device connected',
            speed: 0,
            gsmSignal: 0,
            engineOn: false,
            lastUpdated: new Date(),
          }
        : prev
    );
  }, []);

  const scheduleDeviceOffline = useCallback(() => {
    if (deviceOfflineTimerRef.current) {
      window.clearTimeout(deviceOfflineTimerRef.current);
    }

    deviceOfflineTimerRef.current = window.setTimeout(() => {
      markDeviceOffline();
    }, DEVICE_TIMEOUT_MS);
  }, [markDeviceOffline]);

  const selectedDeviceFilter = settings.tracking.deviceFilter?.trim().toUpperCase() || 'ALL';

  useEffect(() => {
    selectedDeviceFilterRef.current = selectedDeviceFilter;
  }, [selectedDeviceFilter]);

  useEffect(() => {
    autoReconnectRef.current = settings.connection.autoReconnect;
    settingsRef.current = settings;
    if (socketRef.current) {
      socketRef.current.io.opts.reconnection = settings.connection.autoReconnect;
    }
  }, [settings]);

  const setSelectedDeviceId = useCallback((deviceId: string) => {
    updateDeviceFilter((deviceId || 'ALL').toUpperCase());
  }, [updateDeviceFilter]);

  const resolveTargetDeviceId = useCallback(() => {
    if (selectedDeviceFilter !== 'ALL') {
      return selectedDeviceFilter;
    }

    const currentVehicleId = (data.vehicleId || '').trim();
    if (!currentVehicleId || currentVehicleId.toUpperCase() === 'NO DEVICE CONNECTED') {
      if (onlineDevices.length === 1) {
        return onlineDevices[0];
      }
      return null;
    }

    return currentVehicleId;
  }, [availableDevices, data.vehicleId, selectedDeviceFilter]);

  const sendDeviceCommand = useCallback(async (command: 'START_ENGINE' | 'STOP_ENGINE' | 'LOCK' | 'UNLOCK') => {
    const deviceId = resolveTargetDeviceId();
    if (!deviceId) {
      console.warn('[control] No target device selected');
      toast.error('Select a device first', {
        description: 'Choose one active ESP32 in the Active Device dropdown before sending controls.',
      });
      return false;
    }

    try {
      const response = await fetch(`${BACKEND_API_URL}/api/device/${encodeURIComponent(deviceId)}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ command }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData?.error || response.statusText;
        console.error('[control] Failed command:', message);
        toast.error('Command failed', { description: String(message) });
        return false;
      }

      toast.success('Command sent', {
        description: `${command} -> ${deviceId}`,
      });

      return true;
    } catch (error) {
      console.error('[control] Command request failed:', error);
      toast.error('Backend not reachable', {
        description: 'Check backend server and CORS settings.',
      });
      return false;
    }
  }, [resolveTargetDeviceId, session?.access_token]);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) {
      setAvailableDevices([]);
      setOnlineDevices([]);
      return;
    }

    let cancelled = false;

    const loadDevices = async () => {
      try {
        const response = await fetch(`${BACKEND_API_URL}/api/devices`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        const ids = Array.isArray(payload?.devices)
          ? payload.devices
              .map((d: { deviceId?: string }) => (d.deviceId || '').trim().toUpperCase())
              .filter(Boolean)
          : [];

        if (!cancelled) {
          setAvailableDevices(Array.from(new Set(ids)).sort());
        }
      } catch {
        // keep socket-based fallback silently
      }
    };

    loadDevices();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  useEffect(() => {
    const socket = io(effectiveSocketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: autoReconnectRef.current,
      secure: settings.connection.secureMode,
    });

    socketRef.current = socket;

    const setConnectionStatus = (isOnline: boolean) => {
      setData(prev => (prev.socketConnected === isOnline ? prev : { ...prev, socketConnected: isOnline }));
    };

    socket.on('connect', () => {
      setConnectionStatus(true);
    });

    socket.on('devices-state', (payload: { devices?: Array<{ deviceId?: string }> }) => {
      const devices = (payload.devices || []) as Array<{ deviceId?: string; connected?: boolean }>;

      const ids = devices.map(device => (device.deviceId || '').trim().toUpperCase()).filter(Boolean);
      setAvailableDevices(Array.from(new Set(ids)).sort());

      const onlineIds = devices
        .filter(d => Boolean(d.connected))
        .map(d => (d.deviceId || '').trim().toUpperCase())
        .filter(Boolean);
      setOnlineDevices(Array.from(new Set(onlineIds)).sort());
    });

    socket.on('device-status', (payload: { connected: boolean; deviceId?: string | null; lastSeen?: string | null }) => {
      const normalizedEventDevice = (payload.deviceId ?? '').trim().toUpperCase();
      const activeFilter = selectedDeviceFilterRef.current;

      if (activeFilter !== 'ALL' && normalizedEventDevice !== activeFilter) {
        return;
      }

      if (activeFilter === 'ALL' && !payload.connected && !normalizedEventDevice) {
        return;
      }

      setData(prev => {
        if (
          activeFilter === 'ALL' &&
          !payload.connected &&
          normalizedEventDevice &&
          normalizedEventDevice !== prev.vehicleId.toUpperCase()
        ) {
          return prev;
        }

        return {
          ...prev,
          deviceConnected: payload.connected,
          isOnline: payload.connected,
          deviceLastSeen: payload.lastSeen ? new Date(payload.lastSeen) : prev.deviceLastSeen,
          vehicleId: payload.connected
            ? (normalizedEventDevice || prev.vehicleId)
            : (activeFilter === 'ALL' ? (normalizedEventDevice || 'No device connected') : activeFilter),
          speed: payload.connected ? prev.speed : 0,
          gsmSignal: payload.connected ? prev.gsmSignal : 0,
          engineOn: payload.connected ? prev.engineOn : false,
          lastUpdated: new Date(),
        };
      });

      if (payload.connected) {
        scheduleDeviceOffline();
        if (normalizedEventDevice) {
          setOnlineDevices(prev => (prev.includes(normalizedEventDevice) ? prev : [...prev, normalizedEventDevice].sort()));
        }
      } else if (deviceOfflineTimerRef.current) {
        window.clearTimeout(deviceOfflineTimerRef.current);
        if (normalizedEventDevice) {
          setOnlineDevices(prev => prev.filter(id => id !== normalizedEventDevice));
        }
      }
    });

    socket.on('location', (payload: unknown) => {
      const location = parseLocationPayload(payload);

      if (!location) {
        return;
      }

      const eventDeviceId = (location.deviceId ?? location.vehicleId ?? '').toUpperCase();

      if (eventDeviceId) {
        setAvailableDevices(prev => (prev.includes(eventDeviceId) ? prev : [...prev, eventDeviceId].sort()));
        setOnlineDevices(prev => (prev.includes(eventDeviceId) ? prev : [...prev, eventDeviceId].sort()));
      }

      if (selectedDeviceFilterRef.current !== 'ALL' && eventDeviceId !== selectedDeviceFilterRef.current) {
        return;
      }

      scheduleDeviceOffline();

      setData(prev => {
        const activeSettings = settingsRef.current;
        const speed = Number.isFinite(location.speed ?? Number.NaN) ? Number(location.speed) : prev.speed;
        const nextSpeed = location.engineOn === false ? 0 : Math.round(speed);
        const gsmSignal = Number.isFinite(location.gsmSignal ?? Number.NaN)
          ? Math.max(0, Math.min(5, Number(location.gsmSignal)))
          : prev.gsmSignal;
        const geofenceDistanceMeters = haversineMeters(
          location.latitude,
          location.longitude,
          activeSettings.tracking.geofenceCenterLat,
          activeSettings.tracking.geofenceCenterLng
        );
        const overspeedTriggered = activeSettings.notifications.overspeed && nextSpeed > activeSettings.tracking.speedLimit;
        const geofenceTriggered = activeSettings.notifications.geofence && geofenceDistanceMeters > activeSettings.tracking.geofenceRadiusMeters;
        const idleTriggered =
          activeSettings.notifications.idle &&
          location.engineOn !== false &&
          nextSpeed === 0 &&
          prev.speedHistory.slice(-3).every(entry => entry.speed === 0);
        const newAlerts = [...prev.alerts];

        if (overspeedTriggered) {
          newAlerts.unshift({
            id: `overspeed-${Date.now()}`,
            type: 'overspeed',
            message: `Speed alert: ${nextSpeed} km/h exceeded ${activeSettings.tracking.speedLimit} km/h`,
            timestamp: new Date(),
            severity: 'warning',
          });
        }

        if (geofenceTriggered) {
          newAlerts.unshift({
            id: `geofence-${Date.now()}`,
            type: 'geofence',
            message: `Vehicle left the geofence by ${Math.round(geofenceDistanceMeters - activeSettings.tracking.geofenceRadiusMeters)} m`,
            timestamp: new Date(),
            severity: 'critical',
          });
        }

        if (idleTriggered) {
          newAlerts.unshift({
            id: `idle-${Date.now()}`,
            type: 'idle',
            message: `Vehicle idle for ${activeSettings.tracking.idleMinutes} min threshold`,
            timestamp: new Date(),
            severity: 'info',
          });
        }

        return {
          ...prev,
          vehicleId: location.deviceId ?? location.vehicleId ?? prev.vehicleId,
          latitude: location.latitude,
          longitude: location.longitude,
          speed: nextSpeed,
          gsmSignal,
          engineOn: location.engineOn ?? prev.engineOn,
          locked: location.locked ?? prev.locked,
          isOnline: true,
          socketConnected: true,
          deviceConnected: true,
          deviceLastSeen: new Date(location.timestamp ?? Date.now()),
          lastUpdated: new Date(location.timestamp ?? Date.now()),
          routeHistory: [...prev.routeHistory, [location.latitude, location.longitude] as [number, number]].slice(-50) as [number, number][],
          alerts: newAlerts.slice(0, 20),
          speedHistory: [
            ...prev.speedHistory.slice(1),
            { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), speed: nextSpeed },
          ],
        };
      });
    });

    socket.on('connect_error', () => {
      setConnectionStatus(false);
      markDeviceOffline();
    });

    socket.on('disconnect', () => {
      setConnectionStatus(false);
      markDeviceOffline();
    });

    return () => {
      socket.off();
      socket.disconnect();
      socketRef.current = null;
      if (deviceOfflineTimerRef.current) {
        window.clearTimeout(deviceOfflineTimerRef.current);
        deviceOfflineTimerRef.current = null;
      }
    };
  }, [scheduleDeviceOffline, markDeviceOffline, effectiveSocketUrl, settings.connection.secureMode]);

  useEffect(() => {
    if (selectedDeviceFilter === 'ALL') {
      return;
    }

    setData(prev => ({
      ...prev,
      vehicleId: selectedDeviceFilter,
      deviceConnected: false,
      isOnline: false,
      speed: 0,
      gsmSignal: 0,
      engineOn: false,
      routeHistory: [],
      lastUpdated: new Date(),
    }));
  }, [selectedDeviceFilter]);

  const toggleEngine = useCallback(async () => {
    const command = data.engineOn ? 'STOP_ENGINE' : 'START_ENGINE';
    const sent = await sendDeviceCommand(command);

    if (!sent) {
      return;
    }

    setData(prev => {
      const newState = !prev.engineOn;
      return {
        ...prev,
        engineOn: newState,
        speed: newState ? prev.speed : 0,
        alerts: [{
          id: Date.now().toString(),
          type: 'engine' as const,
          message: `Command sent: ${newState ? 'START_ENGINE' : 'STOP_ENGINE'}`,
          timestamp: new Date(),
          severity: 'info' as const,
        }, ...prev.alerts].slice(0, 20),
      };
    });
  }, [data.engineOn, sendDeviceCommand]);

  const toggleLock = useCallback(async () => {
    const command = data.locked ? 'UNLOCK' : 'LOCK';
    const sent = await sendDeviceCommand(command);

    if (!sent) {
      return;
    }

    setData(prev => ({
      ...prev,
      locked: !prev.locked,
      alerts: [{
        id: Date.now().toString(),
        type: 'engine' as const,
        message: `Command sent: ${command}`,
        timestamp: new Date(),
        severity: 'info' as const,
      }, ...prev.alerts].slice(0, 20),
    }));
  }, [data.locked, sendDeviceCommand]);

  return (
    <VehicleContext.Provider
      value={{
        data,
        availableDevices,
        onlineDevices,
        selectedDeviceId: selectedDeviceFilter,
        setSelectedDeviceId,
        toggleEngine,
        toggleLock,
      }}
    >
      {children}
    </VehicleContext.Provider>
  );
};

const haversineMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const earthRadius = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
