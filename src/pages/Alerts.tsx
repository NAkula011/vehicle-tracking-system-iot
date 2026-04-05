import React from 'react';
import { motion } from 'framer-motion';
import { useVehicle } from '@/contexts/VehicleContext';
import { AlertTriangle, Info, AlertCircle } from 'lucide-react';

const severityConfig = {
  critical: { icon: AlertCircle, bg: 'bg-neon-red/10', border: 'border-neon-red/20', text: 'text-neon-red', dot: 'bg-neon-red' },
  warning: { icon: AlertTriangle, bg: 'bg-neon-orange/10', border: 'border-neon-orange/20', text: 'text-neon-orange', dot: 'bg-neon-orange' },
  info: { icon: Info, bg: 'bg-neon-blue/10', border: 'border-neon-blue/20', text: 'text-neon-blue', dot: 'bg-neon-blue' },
};

const Alerts: React.FC = () => {
  const { data } = useVehicle();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Alerts</h2>
        <span className="text-xs text-muted-foreground">{data.alerts.length} total</span>
      </div>
      <div className="space-y-3">
        {data.alerts.map((alert, i) => {
          const config = severityConfig[alert.severity];
          const Icon = config.icon;
          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`glass-card p-4 ${config.border} border flex items-start gap-3`}
            >
              <Icon className={`w-5 h-5 ${config.text} flex-shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>
                    {alert.severity}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">{alert.type}</span>
                </div>
                <p className="text-sm text-foreground">{alert.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{alert.timestamp.toLocaleString()}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default Alerts;
