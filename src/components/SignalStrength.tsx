import React from 'react';
import { useVehicle } from '@/contexts/VehicleContext';

const SignalStrength: React.FC<{ bars?: number }> = ({ bars }) => {
  const { data } = useVehicle();
  const signal = bars ?? data.gsmSignal;

  return (
    <div className="flex items-end gap-0.5 h-5">
      {[1, 2, 3, 4, 5].map((level) => (
        <div
          key={level}
          className={`signal-bar w-1.5 rounded-sm transition-all duration-300 ${
            level <= signal
              ? level <= 2 ? 'bg-neon-red' : level <= 3 ? 'bg-neon-orange' : 'bg-neon-green'
              : 'bg-muted'
          }`}
          style={{ height: `${level * 4}px` }}
        />
      ))}
    </div>
  );
};

export default SignalStrength;
