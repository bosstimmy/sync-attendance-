import React, { useState, useEffect } from 'react';
import CreateEvent from './components/CreateEvent';
import CheckIn from './components/CheckIn';
import Dashboard from './components/Dashboard';

interface RouteState {
  eventId: string | null;
  adminKey: string | null;
}

export default function App() {
  const [route, setRoute] = useState<RouteState>({ eventId: null, adminKey: null });

  // Parse URL search parameters on load & on history navigation (popstate)
  useEffect(() => {
    const parseUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const eventId = params.get('event');
      const adminKey = params.get('adminKey');
      setRoute({ eventId, adminKey });
    };

    // Run once on mount
    parseUrl();

    // Listen to back/forward browser navigation
    window.addEventListener('popstate', parseUrl);
    return () => {
      window.removeEventListener('popstate', parseUrl);
    };
  }, []);

  // Centralized router helper
  const navigateTo = (eventId: string | null, adminKey: string | null = null) => {
    let newUrl = window.location.pathname;
    if (eventId) {
      newUrl += `?event=${eventId}`;
      if (adminKey) {
        newUrl += `&adminKey=${adminKey}`;
      }
    }
    window.history.pushState({}, '', newUrl);
    setRoute({ eventId, adminKey });
  };

  const handleNavigateHome = () => {
    navigateTo(null);
  };

  const handleNavigateToEvent = (eventId: string, adminKey?: string) => {
    navigateTo(eventId, adminKey || null);
  };

  return (
    <div className="min-h-screen gradient-bg flex flex-col justify-between">
      <main className="flex-grow">
        {/* Simple Page Routing */}
        {route.eventId === null ? (
          // Main Portal / Event Creation
          <CreateEvent onNavigate={handleNavigateToEvent} />
        ) : route.adminKey !== null ? (
          // Organizer Admin Dashboard
          <Dashboard 
            eventId={route.eventId} 
            adminKey={route.adminKey} 
            onNavigateHome={handleNavigateHome} 
          />
        ) : (
          // Attendee Check-In Form
          <CheckIn 
            eventId={route.eventId} 
            onNavigateHome={handleNavigateHome} 
          />
        )}
      </main>

      {/* Elegant minimalist footer */}
      <footer className="py-6 border-t border-gray-100 bg-white/50 backdrop-blur-sm text-center">
        <p className="text-xs text-gray-400 font-mono">
          SyncAttendance • Live Attendance Logging Portal • European West Node
        </p>
      </footer>
    </div>
  );
}
