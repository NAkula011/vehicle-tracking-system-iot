import React from 'react';
import { motion } from 'framer-motion';
import VehicleMap from '@/components/VehicleMap';
import { useVehicle } from '@/contexts/VehicleContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const RouteHistory: React.FC = () => {
  const { data } = useVehicle();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">Route History</h2>
      <VehicleMap showRoute className="h-[400px]" />
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Speed During Route</h3>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.speedHistory}>
              <defs>
                <linearGradient id="routeSpeedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(190, 95%, 50%)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(190, 95%, 50%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(230, 20%, 18%)" />
              <XAxis dataKey="time" stroke="hsl(220, 15%, 55%)" fontSize={10} />
              <YAxis stroke="hsl(220, 15%, 55%)" fontSize={10} />
              <Tooltip contentStyle={{ background: 'hsl(230, 22%, 10%)', border: '1px solid hsl(230, 20%, 18%)', borderRadius: '8px', color: 'hsl(220, 20%, 92%)', fontSize: '12px' }} />
              <Area type="monotone" dataKey="speed" stroke="hsl(190, 95%, 50%)" fill="url(#routeSpeedGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Waypoints ({data.routeHistory.length})</h3>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {data.routeHistory.slice(-10).reverse().map((point, i) => (
            <div key={i} className="flex items-center gap-3 text-xs text-muted-foreground py-1">
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
              <span>Lat: {point[0].toFixed(6)}, Lng: {point[1].toFixed(6)}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};

export default RouteHistory;
