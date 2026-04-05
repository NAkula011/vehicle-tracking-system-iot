import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Gauge, MapPin, Clock, Signal, Power, Lock, Unlock,
  Navigation, Activity, Zap, Shield, Radio, TrendingUp,
  AlertTriangle
} from 'lucide-react';
import { useVehicle } from '@/contexts/VehicleContext';
import VehicleMap from '@/components/VehicleMap';
import SignalStrength from '@/components/SignalStrength';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { toast } from '@/components/ui/sonner';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } };

/* ─── Speedometer Ring ─── */
const SpeedGauge: React.FC<{ speed: number; maxSpeed?: number }> = ({ speed, maxSpeed = 120 }) => {
  const pct = Math.min(speed / maxSpeed, 1);
  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - pct * 0.75); // 270° arc

  return (
    <div className="relative w-36 h-36 sm:w-44 sm:h-44 mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-[135deg]">
        {/* Track */}
        <circle cx="60" cy="60" r="54" fill="none" stroke="hsl(230, 20%, 15%)" strokeWidth="8"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`} strokeLinecap="round" />
        {/* Value */}
        <motion.circle
          cx="60" cy="60" r="54" fill="none"
          stroke="url(#speedGaugeGradient)" strokeWidth="8"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut' }}
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="speedGaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(190, 95%, 50%)" />
            <stop offset="50%" stopColor="hsl(265, 90%, 60%)" />
            <stop offset="100%" stopColor="hsl(0, 85%, 55%)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          key={speed}
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          className="text-3xl sm:text-4xl font-black text-foreground tabular-nums"
        >
          {speed}
        </motion.span>
        <span className="text-[10px] text-muted-foreground font-medium tracking-wider">KM/H</span>
      </div>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const { data, toggleEngine, toggleLock, availableDevices, onlineDevices, selectedDeviceId, setSelectedDeviceId } = useVehicle();
  const { session } = useAuth();
  const { settings } = useSettings();
  const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL ?? '';
  const [systemLocation, setSystemLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][] | null>(null);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeEtaSec, setRouteEtaSec] = useState<number | null>(null);
  const [routeUpdatedAt, setRouteUpdatedAt] = useState<Date | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [label, setLabel] = useState('');
  const [locType, setLocType] = useState('home');
  const [isHome, setIsHome] = useState(true);
  const [lat, setLat] = useState<number | ''>(data.latitude ?? '');
  const [lng, setLng] = useState<number | ''>(data.longitude ?? '');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [useSystemLocation, setUseSystemLocation] = useState(true);

  const hasDevice = data.deviceConnected;
  const hasLastLocation = Boolean(data.deviceLastSeen);
  const lastSeenLabel = data.deviceLastSeen ? data.deviceLastSeen.toLocaleTimeString() : 'Never';

  const latestPosition = hasDevice || hasLastLocation ? `${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}` : 'Waiting for device...';
  const lastUpdatedLabel = hasDevice
    ? data.lastUpdated.toLocaleTimeString()
    : data.deviceLastSeen
    ? data.deviceLastSeen.toLocaleTimeString()
    : 'No live feed';
  const systemPositionLabel = systemLocation ? `${systemLocation.lat.toFixed(4)}, ${systemLocation.lng.toFixed(4)}` : 'Waiting for GPS...';

  useEffect(() => {
    if (useSystemLocation && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLat(pos.coords.latitude);
          setLng(pos.coords.longitude);
        },
        (err) => {
          // keep existing lat/lng if permission denied or error
          toast.error('Could not access system location. Please allow location access or enter coordinates manually.');
        },
        { enableHighAccuracy: true, maximumAge: 60_000 }
      );
    }
  }, [useSystemLocation]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setSystemLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        // keep last known system position if permission denied later
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const fetchRouteToVehicle = async (start: { lat: number; lng: number }) => {
    if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) return;

    setRouteLoading(true);
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${data.longitude},${data.latitude}?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl);
      if (!res.ok) throw new Error('Routing error');

      const payload = await res.json();
      const route = payload?.routes?.[0];
      const coords: [number, number][] = payload?.routes?.[0]?.geometry?.coordinates
        ? payload.routes[0].geometry.coordinates.map((pt: [number, number]) => [pt[1], pt[0]])
        : [];

      setRouteCoordinates(coords.length > 1 ? coords : null);
      setRouteDistanceKm(typeof route?.distance === 'number' ? route.distance / 1000 : null);
      setRouteEtaSec(typeof route?.duration === 'number' ? route.duration : null);
      setRouteUpdatedAt(new Date());
    } catch (error) {
      setRouteCoordinates(null);
      setRouteDistanceKm(null);
      setRouteEtaSec(null);
      toast.error('Unable to load route');
    } finally {
      setRouteLoading(false);
    }
  };

  const formatEta = (seconds: number | null) => {
    if (seconds === null || !Number.isFinite(seconds)) return '—';
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${totalMinutes} min`;
    if (mins === 0) return `${hours} hr`;
    return `${hours} hr ${mins} min`;
  };

  useEffect(() => {
    if (systemLocation && hasDevice) {
      void fetchRouteToVehicle(systemLocation);
    }
  }, [systemLocation?.lat, systemLocation?.lng, data.latitude, data.longitude, hasDevice]);

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-4 sm:space-y-5">

      {!hasDevice && (
        <motion.div variants={item} className="glass-card border border-neon-orange/20 bg-neon-orange/8 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">No device connected</p>
              <p className="text-xs text-muted-foreground">
                The backend is running, but device stream is offline.
              </p>
            </div>
            <div className="text-xs text-neon-orange font-medium">
              Last seen: {lastSeenLabel}
            </div>
          </div>
        </motion.div>
      )}

      {/* ─── Hero Row: Speedometer + Quick Stats ─── */}
      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 sm:gap-4">

        {/* Speedometer card */}
        <div className="stat-card sm:col-span-1 lg:col-span-3 flex flex-col items-center justify-center py-5">
          <SpeedGauge speed={data.speed} maxSpeed={Math.max(40, settings.tracking.speedLimit)} />
          <div className="flex items-center gap-2 mt-2">
            <span className={`w-2 h-2 rounded-full ${data.engineOn ? 'bg-neon-green animate-pulse-glow' : 'bg-neon-red'}`} />
            <span className={`text-xs font-medium ${data.engineOn ? 'text-neon-green' : 'text-neon-red'}`}>
              {hasDevice ? `Engine ${data.engineOn ? 'Running' : 'Off'}` : 'No live engine data'}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Limit: {settings.tracking.speedLimit} km/h</p>
        </div>

        {/* Quick stats grid */}
        <div className="sm:col-span-1 lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuickStat icon={Navigation} label="Vehicle" value={hasDevice ? data.vehicleId : 'No device connected'} color="text-primary" />
          <QuickStat icon={MapPin} label="Position" value={latestPosition} color="text-neon-green" />
          <QuickStat icon={Clock} label="Updated" value={lastUpdatedLabel} color="text-neon-orange" />
          <QuickStat icon={Radio} label="My GPS" value={systemPositionLabel} color="text-neon-cyan" />
          <div className="stat-card flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-neon-purple/10 flex items-center justify-center flex-shrink-0">
              <Signal className="w-4 h-4 text-neon-purple" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">GSM Signal</p>
              <div className="flex items-center gap-2 mt-0.5">
                <SignalStrength />
                <span className="text-xs font-bold text-foreground">{hasDevice ? `${data.gsmSignal}/5` : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Controls + Status */}
        <div className="sm:col-span-2 lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
          {/* Control buttons */}
          <div className="stat-card space-y-2">
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-primary" /> Controls
            </h3>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Active Device</p>
              <select
                value={selectedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                aria-label="Select active device"
                disabled={onlineDevices.length === 0}
              >
                <option value="ALL">ALL devices</option>
                {onlineDevices.length === 0 ? (
                  <option value="ALL" disabled>No devices online</option>
                ) : (
                  onlineDevices.map(deviceId => (
                    <option key={deviceId} value={deviceId}>{deviceId}</option>
                  ))
                )}
              </select>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={toggleEngine}
                className={`w-full text-xs ${data.engineOn ? 'control-btn-danger' : 'control-btn-success'}`}
                disabled={!hasDevice || onlineDevices.length === 0}
                aria-disabled={!hasDevice || onlineDevices.length === 0}
              >
                <Power className="w-3.5 h-3.5" />
                {data.engineOn ? 'Stop Engine' : 'Start Engine'}
              </button>
              <button
                onClick={toggleLock}
                className={`w-full text-xs ${data.locked ? 'control-btn-primary' : 'control-btn-danger'}`}
                disabled={!hasDevice || onlineDevices.length === 0}
                aria-disabled={!hasDevice || onlineDevices.length === 0}
              >
                {data.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                {data.locked ? 'Unlock' : 'Lock'}
              </button>
            </div>

            {/* Add Location dialog trigger */}
            <div className="mt-2">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto">Add Location</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Location</DialogTitle>
                    <DialogDescription>Save a place (Home, Work, POI) for quick actions.</DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-2">
                    <label className="text-xs text-muted-foreground">Label</label>
                    <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Home, Office" />

                    <label className="text-xs text-muted-foreground">Type</label>
                    <select className="rounded-md border border-input bg-background px-2 py-1 text-sm" value={locType} onChange={(e) => setLocType(e.target.value)}>
                      <option value="home">Home</option>
                      <option value="work">Work</option>
                      <option value="poi">POI</option>
                      <option value="other">Other</option>
                    </select>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Latitude</label>
                        <Input value={lat ?? ''} onChange={(e) => setLat(Number(e.target.value))} placeholder="Latitude" readOnly={useSystemLocation} disabled={useSystemLocation} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Longitude</label>
                        <Input value={lng ?? ''} onChange={(e) => setLng(Number(e.target.value))} placeholder="Longitude" readOnly={useSystemLocation} disabled={useSystemLocation} />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Checkbox checked={isHome} onCheckedChange={(v) => setIsHome(Boolean(v))} />
                      <span className="text-sm">Set as Home</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Checkbox checked={useSystemLocation} onCheckedChange={(v) => setUseSystemLocation(Boolean(v))} />
                      <span className="text-sm">Use system (device) location</span>
                    </div>

                    <div className="flex items-center gap-2 justify-end mt-3">
                      <Button variant="default" size="sm" onClick={async () => {
                        try {
                          const numericLat = Number(lat);
                          const numericLng = Number(lng);
                          if (!label || !Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
                            toast.error('Please provide a label and valid coordinates');
                            return;
                          }

                          const resp = await fetch(`${BACKEND_API_URL}/api/locations`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                            },
                            body: JSON.stringify({ label, latitude: numericLat, longitude: numericLng, type: locType, is_home: isHome }),
                          });

                          const payload = await resp.json().catch(() => ({}));
                          if (!resp.ok) {
                            toast.error('Save failed', { description: payload?.error || resp.statusText });
                            return;
                          }

                          toast.success('Location saved');
                          setDialogOpen(false);
                        } catch (err) {
                          toast.error('Save failed');
                        }
                      }}>Save</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Status indicators */}
          <div className="stat-card space-y-2">
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-neon-cyan" /> Status
            </h3>
            {[
              { label: 'Engine', on: data.engineOn },
              { label: 'Doors', on: data.locked },
              { label: 'Device', on: hasDevice },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{s.label}</span>
                <span className={`flex items-center gap-1 font-medium ${s.on ? 'text-neon-green' : 'text-neon-red'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.on ? 'bg-neon-green' : 'bg-neon-red'}`} />
                  {s.on ? 'OK' : 'Offline'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ─── Map ─── */}
      <motion.div variants={item} className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs sm:text-sm font-semibold text-foreground">Live Map</h3>
          <span className="text-[10px] sm:text-xs text-muted-foreground"></span>
        </div>
        <VehicleMap showRoute routeCoordinates={routeCoordinates} systemLocation={systemLocation} className="h-[250px] sm:h-[340px] lg:h-[400px]" />
      </motion.div>

      {/* Trace controls + direction */}
      <motion.div variants={item} className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4 items-stretch">
        <div className="space-y-3">
          <div className="stat-card w-full">
            <h4 className="text-xs font-semibold text-muted-foreground">Navigation</h4>
            <p className="text-[11px] text-muted-foreground mb-2">Trace from your device to the ESP32 vehicle using live GPS and OSRM routing.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={async () => {
                try {
                  let startLat = systemLocation?.lat ?? Number(lat);
                  let startLng = systemLocation?.lng ?? Number(lng);
                  if (!Number.isFinite(startLat) || !Number.isFinite(startLng)) {
                    if (typeof navigator !== 'undefined' && navigator.geolocation) {
                      await new Promise<void>((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition((pos) => {
                          startLat = pos.coords.latitude;
                          startLng = pos.coords.longitude;
                          setSystemLocation({ lat: startLat, lng: startLng });
                          resolve();
                        }, (err) => {
                          reject(err);
                        }, { enableHighAccuracy: true });
                      });
                    } else {
                      toast.error('System geolocation unavailable');
                      return;
                    }
                  }

                  const endLat = data.latitude;
                  const endLng = data.longitude;
                  if (!Number.isFinite(endLat) || !Number.isFinite(endLng)) {
                    toast.error('Vehicle location not available');
                    return;
                  }

                  await fetchRouteToVehicle({ lat: startLat, lng: startLng });
                  toast.success('Route loaded');
                } catch (err) {
                  toast.error('Unable to load route');
                }
              }} disabled={!hasDevice || routeLoading}>{routeLoading ? 'Loading…' : 'Trace to vehicle'}</Button>

              <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={() => {
                setRouteCoordinates(null);
                setRouteDistanceKm(null);
                setRouteEtaSec(null);
                setRouteUpdatedAt(null);
              }}>Clear Route</Button>
            </div>
          </div>

          <div className="stat-card w-full">
            <h4 className="text-xs font-semibold text-muted-foreground">My GPS → Vehicle</h4>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">Distance</p>
                <p className="text-sm sm:text-base font-semibold text-foreground">
                  {routeDistanceKm !== null ? `${routeDistanceKm.toFixed(2)} km` : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">ETA</p>
                <p className="text-sm sm:text-base font-semibold text-foreground">{formatEta(routeEtaSec)}</p>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {routeUpdatedAt ? `Updated: ${routeUpdatedAt.toLocaleTimeString()}` : 'Waiting for route...'}
            </p>
          </div>
        </div>

        <div className="stat-card w-full">
          <h4 className="text-xs font-semibold text-muted-foreground">Current direction of my vehicle</h4>
          <DirectionDisplay data={data} />
        </div>
      </motion.div>

      {/* ─── Charts + Alerts Row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Speed chart */}
        <motion.div variants={item} className="lg:col-span-3 glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-neon-cyan" />
              Speed History
            </h3>
            <span className="text-[10px] text-muted-foreground">Last 24 readings</span>
          </div>
          <div className="h-[160px] sm:h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.speedHistory}>
                <defs>
                  <linearGradient id="dashSpeedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(265, 90%, 60%)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(265, 90%, 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(230, 20%, 15%)" />
                <XAxis dataKey="time" stroke="hsl(220, 15%, 45%)" fontSize={9} tickLine={false} interval="preserveStartEnd" />
                <YAxis stroke="hsl(220, 15%, 45%)" fontSize={9} tickLine={false} width={30} />
                <Tooltip contentStyle={{
                  background: 'hsl(230, 22%, 10%)', border: '1px solid hsl(230, 20%, 18%)',
                  borderRadius: '8px', color: 'hsl(220, 20%, 92%)', fontSize: '11px',
                }} />
                <Area type="monotone" dataKey="speed" stroke="hsl(265, 90%, 60%)" fill="url(#dashSpeedGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Recent alerts */}
        <motion.div variants={item} className="lg:col-span-2 glass-card p-4">
          <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-neon-orange" />
            Recent Alerts
          </h3>
          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin">
            {data.alerts.slice(0, 6).map((alert) => (
              <div key={alert.id} className={`flex items-start gap-2 p-2.5 rounded-lg text-xs
                ${alert.severity === 'critical' ? 'bg-neon-red/8 border border-neon-red/15' :
                  alert.severity === 'warning' ? 'bg-neon-orange/8 border border-neon-orange/15' :
                  'bg-neon-blue/8 border border-neon-blue/15'}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${
                  alert.severity === 'critical' ? 'bg-neon-red' :
                  alert.severity === 'warning' ? 'bg-neon-orange' : 'bg-neon-blue'
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground leading-tight">{alert.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{alert.timestamp.toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
            {data.alerts.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No alerts</p>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

/* ─── Reusable stat card ─── */
const QuickStat: React.FC<{ icon: React.ElementType; label: string; value: string; color: string }> = ({
  icon: Icon, label, value, color
}) => (
  <div className="stat-card flex items-center gap-3">
    <div className={`w-9 h-9 rounded-lg ${color.replace('text-', 'bg-')}/10 flex items-center justify-center flex-shrink-0`}>
      <Icon className={`w-4 h-4 ${color}`} />
    </div>
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs font-bold text-foreground truncate mt-0.5">{value}</p>
    </div>
  </div>
);

const DirectionDisplay: React.FC<{ data: any }> = ({ data }) => {
  const computeBearing = (): number | null => {
    try {
      if (data.routeHistory && data.routeHistory.length >= 2) {
        const a = data.routeHistory[data.routeHistory.length - 2];
        const b = data.routeHistory[data.routeHistory.length - 1];
        const lat1 = (a[0] * Math.PI) / 180;
        const lat2 = (b[0] * Math.PI) / 180;
        const dLon = ((b[1] - a[1]) * Math.PI) / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const brng = (Math.atan2(y, x) * 180) / Math.PI;
        return Math.round(((brng + 360) % 360));
      }
      if (typeof data.heading === 'number') return Math.round(data.heading);
      if (typeof data.bearing === 'number') return Math.round(data.bearing);
      return null;
    } catch (e) {
      return null;
    }
  };

  const degToCardinal = (deg: number) => {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const ix = Math.round((deg % 360) / 22.5) % 16;
    return dirs[ix];
  };

  const bearing = computeBearing();
  return (
    <div className="pt-2">
      {bearing === null ? (
        <p className="text-sm text-muted-foreground">Direction unknown</p>
      ) : (
        <div>
          <p className="text-lg font-semibold">{bearing}°</p>
          <p className="text-xs text-muted-foreground">{degToCardinal(bearing)}</p>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
