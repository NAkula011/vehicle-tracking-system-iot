import React from 'react';
import { LayoutDashboard, MapPin, Car, AlertTriangle, Settings } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

const tabs = [
  { icon: LayoutDashboard, path: '/', label: 'Home' },
  { icon: MapPin, path: '/tracking', label: 'Track' },
  { icon: Car, path: '/vehicle', label: 'Vehicle' },
  { icon: AlertTriangle, path: '/alerts', label: 'Alerts' },
  { icon: Settings, path: '/settings', label: 'Settings' },
];

const MobileBottomNav: React.FC = () => {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-card/92 backdrop-blur-xl border-t border-border safe-area-bottom shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-around h-16 px-1">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-xl transition-colors min-w-[54px] touch-manipulation
                ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <tab.icon className={`w-5 h-5 ${isActive ? 'drop-shadow-[0_0_6px_hsl(265,90%,60%)]' : ''}`} />
              <span className="text-[10px] font-medium leading-none truncate max-w-[56px]">{tab.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
