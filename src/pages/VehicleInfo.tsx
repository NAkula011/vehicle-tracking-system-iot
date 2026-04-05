import React from 'react';
import { motion } from 'framer-motion';
import { useVehicle } from '@/contexts/VehicleContext';
import { Car, Cpu, Radio, Battery, Thermometer, Gauge } from 'lucide-react';

const VehicleInfo: React.FC = () => {
  const { data } = useVehicle();

  const specs = [
    { label: 'Vehicle ID', value: data.vehicleId, icon: Car },
    { label: 'GPS Module', value: 'NEO-6M', icon: Radio },
    { label: 'GSM Module', value: 'SIM800L', icon: Cpu },
    { label: 'MCU', value: 'ESP32', icon: Cpu },
    { label: 'Battery', value: '12V Li-Po', icon: Battery },
    { label: 'Max Speed', value: '120 km/h', icon: Gauge },
    { label: 'Operating Temp', value: '-20°C to 70°C', icon: Thermometer },
    { label: 'Protocol', value: 'MQTT over GSM', icon: Radio },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">Vehicle Information</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {specs.map((spec, i) => (
          <motion.div
            key={spec.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="stat-card"
          >
            <spec.icon className="w-5 h-5 text-primary mb-2" />
            <p className="text-xs text-muted-foreground">{spec.label}</p>
            <p className="text-sm font-bold text-foreground mt-1">{spec.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Current Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Engine</p>
            <p className={`font-bold ${data.engineOn ? 'text-neon-green' : 'text-neon-red'}`}>
              {data.engineOn ? 'Running' : 'Off'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Lock</p>
            <p className={`font-bold ${data.locked ? 'text-neon-green' : 'text-neon-red'}`}>
              {data.locked ? 'Locked' : 'Unlocked'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Speed</p>
            <p className="font-bold text-neon-cyan">{data.speed} km/h</p>
          </div>
          <div>
            <p className="text-muted-foreground">GSM Signal</p>
            <p className="font-bold text-neon-purple">{data.gsmSignal}/5 bars</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default VehicleInfo;
