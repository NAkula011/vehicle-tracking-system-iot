import React from 'react';
import { Outlet } from 'react-router-dom';
import AppSidebar, { MobileSidebarProvider } from './AppSidebar';
import Navbar from './Navbar';
import MobileBottomNav from './MobileBottomNav';

const DashboardLayout: React.FC = () => {
  return (
    <MobileSidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
          <Navbar />
          <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto pb-24 md:pb-6">
            <Outlet />
          </main>
        </div>
        <MobileBottomNav />
      </div>
    </MobileSidebarProvider>
  );
};

export default DashboardLayout;
