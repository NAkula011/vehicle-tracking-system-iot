import React, { useState, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, MapPin, Car, Route, AlertTriangle, Settings,
  X
} from 'lucide-react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';

const menuItems = [
  { title: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { title: 'Live Tracking', icon: MapPin, path: '/tracking' },
  { title: 'Vehicle Info', icon: Car, path: '/vehicle' },
  { title: 'Route History', icon: Route, path: '/history' },
  { title: 'Alerts', icon: AlertTriangle, path: '/alerts' },
  { title: 'Settings', icon: Settings, path: '/settings' },
];

// Sidebar open/close context for mobile
interface SidebarContextType {
  open: boolean;
  setOpen: (v: boolean) => void;
}
const SidebarCtx = createContext<SidebarContextType>({ open: false, setOpen: () => {} });
export const useMobileSidebar = () => useContext(SidebarCtx);
export const MobileSidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  return <SidebarCtx.Provider value={{ open, setOpen }}>{children}</SidebarCtx.Provider>;
};

const AppSidebar: React.FC = () => {
  const location = useLocation();
  const { open, setOpen } = useMobileSidebar();

  // Desktop: always visible narrow sidebar. Mobile: overlay drawer.
  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex h-screen sticky top-0 flex-col border-r border-border bg-sidebar z-30 w-[220px] lg:w-[240px]">
        <SidebarContent location={location} onNavigate={() => {}} />
      </aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 md:hidden"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 bottom-0 w-[88vw] max-w-[300px] bg-sidebar border-r border-border z-50 flex flex-col md:hidden h-[100dvh]"
            >
              <div className="flex items-center justify-between px-4 h-16 border-b border-border">
                <div className="flex items-center gap-2">
                  <img src="/logovt.png" alt="VTrack logo" className="w-9 h-9 rounded-md object-contain" />
                  <span className="font-bold text-sm text-foreground">VTrack GPS</span>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <SidebarContent location={location} onNavigate={() => setOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

const SidebarContent: React.FC<{ location: ReturnType<typeof useLocation>; onNavigate: () => void }> = ({ location, onNavigate }) => (
  <>
    {/* Logo — desktop only (mobile has its own in the drawer header) */}
    <div className="h-16 items-center px-4 border-b border-border gap-3 hidden md:flex">
      <img src="/logovt.png" alt="VTrack logo" className="w-9 h-9 rounded-md object-contain flex-shrink-0" />
      <span className="font-bold text-sm text-foreground whitespace-nowrap">VTrack GPS</span>
    </div>
    <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto overscroll-contain">
      {menuItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <RouterNavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-all duration-200 min-h-11
              ${isActive
                ? 'bg-primary/15 text-primary neon-glow'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
              }`}
          >
            <item.icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
            <span>{item.title}</span>
          </RouterNavLink>
        );
      })}
    </nav>
  </>
);

export default AppSidebar;
