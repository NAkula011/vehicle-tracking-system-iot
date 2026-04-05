import React from 'react';
import { motion } from 'framer-motion';
import VehicleMap from '@/components/VehicleMap';
import { useVehicle } from '@/contexts/VehicleContext';
import SignalStrength from '@/components/SignalStrength';
import { Gauge, MapPin, Clock } from 'lucide-react';

const LiveTracking: React.FC = () => {
  const { data } = useVehicle();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 h-full">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className={`flex items-center gap-2 ${data.deviceConnected ? 'text-neon-green' : 'text-neon-orange'}`}>
          <span className={`h-2 w-2 rounded-full ${data.deviceConnected ? 'bg-neon-green' : 'bg-neon-orange'}`} />
          {data.deviceConnected ? 'Live device connected' : 'No device connected'}
        </span>
        <span className={`flex items-center gap-2 ${data.socketConnected ? 'text-neon-green' : 'text-destructive'}`}>
          <span className={`h-2 w-2 rounded-full ${data.socketConnected ? 'bg-neon-green' : 'bg-destructive'}`} />
          {data.socketConnected ? 'Backend connected' : 'Waiting for backend'}
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <Gauge className="w-4 h-4 text-neon-cyan" /> {data.speed} km/h
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <MapPin className="w-4 h-4 text-neon-green" /> {data.deviceConnected ? `${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}` : 'Waiting for coordinates'}
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <Clock className="w-4 h-4 text-neon-orange" /> {data.deviceConnected ? data.lastUpdated.toLocaleTimeString() : '—'}
        </span>
        {!data.deviceConnected && (
          <span className="flex items-center gap-2 text-neon-orange">
            <Clock className="w-4 h-4" /> Last seen: {data.deviceLastSeen ? data.deviceLastSeen.toLocaleTimeString() : 'Never'}
          </span>
        )}
        <SignalStrength />
      </div>
      <VehicleMap showRoute className="h-[calc(100vh-200px)]" />
    </motion.div>
  );
};

export default LiveTracking;
