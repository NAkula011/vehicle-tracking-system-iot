import React from 'react';
import { motion } from 'framer-motion';
import { Bell, MapPin, Gauge, Shield, Wifi, RotateCcw, Copy, CheckCircle2, Signal, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/components/ui/sonner';
import { useSettings } from '@/contexts/SettingsContext';
import { useVehicle } from '@/contexts/VehicleContext';
import { useAuth } from '@/contexts/AuthContext';

const SettingToggle: React.FC<{
  label: string;
  description: string;
  icon: React.ElementType;
  enabled: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, description, icon: Icon, enabled, onChange }) => (
  <div className="flex items-center justify-between py-3 gap-4">
    <div className="flex items-center gap-3 min-w-0">
      <Icon className="w-5 h-5 text-primary flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
    <button
      onClick={() => onChange(!enabled)}
      className={`w-11 h-6 rounded-full transition-all duration-300 relative flex-shrink-0 ${enabled ? 'gradient-primary' : 'bg-muted'}`}
      aria-pressed={enabled}
      aria-label={label}
      type="button"
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-foreground transition-transform duration-300 ${enabled ? 'left-6' : 'left-1'}`} />
    </button>
  </div>
);

const SliderField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, suffix, onChange }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground font-medium">{label}</span>
      <span className="text-muted-foreground">{value.toFixed(step < 1 ? 2 : 0)} {suffix}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full h-2 rounded-full appearance-none bg-muted accent-primary"
    />
  </div>
);

const SettingsPage: React.FC = () => {
  const { settings, updateNotification, updateConnection, updateTracking, resetSettings, exportSettings } = useSettings();
  const { data } = useVehicle();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(exportSettings());
    setCopied(true);
    toast.success('Settings copied', { description: 'Current configuration copied to clipboard.' });
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleReset = () => {
    resetSettings();
    toast.info('Settings reset', { description: 'All controls returned to defaults.' });
  };

  const handleLogout = async () => {
    try {
      setIsSigningOut(true);
      await signOut();
      toast.success('Logged out successfully');
      navigate('/login', { replace: true });
    } catch {
      toast.error('Logout failed', { description: 'Please try again.' });
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground">Settings</h2>
          <p className="text-sm text-muted-foreground mt-1"></p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${data.socketConnected ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red'}`}>
          {data.socketConnected ? <Signal className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
          {data.socketConnected ? 'Backend connected' : 'Backend offline'}
        </div>
      </div>

      <div className="glass-card p-6 space-y-1">
        <h3 className="text-sm font-semibold text-foreground mb-2">Notifications</h3>
        <div className="divide-y divide-border">
          <SettingToggle
            icon={Bell}
            label="Overspeed Alerts"
            description={`Notify when speed exceeds ${settings.tracking.speedLimit} km/h`}
            enabled={settings.notifications.overspeed}
            onChange={(value) => updateNotification('overspeed', value)}
          />
          <SettingToggle
            icon={MapPin}
            label="Geofence Alerts"
            description={`Alert when vehicle leaves ${settings.tracking.geofenceRadiusMeters} m radius`}
            enabled={settings.notifications.geofence}
            onChange={(value) => updateNotification('geofence', value)}
          />
          <SettingToggle
            icon={Gauge}
            label="Idle Vehicle Alert"
            description={`Notify after ${settings.tracking.idleMinutes} min idle`}
            enabled={settings.notifications.idle}
            onChange={(value) => updateNotification('idle', value)}
          />
        </div>
      </div>

      <div className="glass-card p-6 space-y-1">
        <h3 className="text-sm font-semibold text-foreground mb-2">Connection</h3>
        <div className="divide-y divide-border">
          <SettingToggle
            icon={Wifi}
            label="Auto-reconnect"
            description="Reconnect automatically if backend disconnects"
            enabled={settings.connection.autoReconnect}
            onChange={(value) => updateConnection('autoReconnect', value)}
          />
          <SettingToggle
            icon={Shield}
            label="Secure Mode"
            description="Prefer encrypted connection settings"
            enabled={settings.connection.secureMode}
            onChange={(value) => updateConnection('secureMode', value)}
          />
        </div>
      </div>

      <div className="glass-card p-6 space-y-5">
        <h3 className="text-sm font-semibold text-foreground">Tracking</h3>
        <SliderField
          label="Speed Limit"
          value={settings.tracking.speedLimit}
          min={30}
          max={150}
          suffix="km/h"
          onChange={(value) => updateTracking('speedLimit', value)}
        />
        <SliderField
          label="Idle Threshold"
          value={settings.tracking.idleMinutes}
          min={5}
          max={60}
          suffix="min"
          onChange={(value) => updateTracking('idleMinutes', value)}
        />
        <SliderField
          label="Geofence Radius"
          value={settings.tracking.geofenceRadiusMeters}
          min={100}
          max={5000}
          step={50}
          suffix="m"
          onChange={(value) => updateTracking('geofenceRadiusMeters', value)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Geofence Center Latitude</label>
            <input
              type="number"
              value={settings.tracking.geofenceCenterLat}
              onChange={(event) => updateTracking('geofenceCenterLat', Number(event.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              step="0.0001"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Geofence Center Longitude</label>
            <input
              type="number"
              value={settings.tracking.geofenceCenterLng}
              onChange={(event) => updateTracking('geofenceCenterLng', Number(event.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              step="0.0001"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          {copied ? <CheckCircle2 className="w-4 h-4 text-neon-green" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy Settings'}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Reset to Defaults
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isSigningOut}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60"
        >
          <LogOut className="w-4 h-4" />
          {isSigningOut ? 'Logging out...' : 'Logout'}
        </button>
      </div>
    </motion.div>
  );
};

export default SettingsPage;
