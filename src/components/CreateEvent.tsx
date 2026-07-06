import React, { useState, useEffect } from 'react';
import { db, getOrCreateUser, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Plus, Calendar, Shield, ExternalLink, Copy, Check, Trash2, ArrowLeft, MapPin } from 'lucide-react';
import { motion } from 'motion/react';

interface LocalEvent {
  eventId: string;
  adminKey: string;
  name: string;
  createdAt: string;
}

interface CreateEventProps {
  onNavigate: (eventId: string, adminKey?: string) => void;
}

export default function CreateEvent({ onNavigate }: CreateEventProps) {
  const [eventName, setEventName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [myEvents, setMyEvents] = useState<LocalEvent[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load existing events from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('attendance_tracker_events');
    if (saved) {
      try {
        setMyEvents(JSON.parse(saved));
      } catch (e) {
        console.error("Error loading events from localStorage", e);
      }
    }
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName.trim()) {
      setError('Please provide an event name.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Sign in or fetch anonymous user details securely
      const user = (await getOrCreateUser()) as any;
      
      // 2. Generate unique alphanumeric IDs
      const eventId = 'ev_' + Math.random().toString(36).substring(2, 11);
      const adminKey = 'adm_' + Math.random().toString(36).substring(2, 15);

      // 3. Attempt to capture high-precision coordinator location token
      let creatorLatitude: number | null = null;
      let creatorLongitude: number | null = null;

      try {
        const coords = await new Promise<{ latitude: number | null; longitude: number | null }>((resolve) => {
          if (!navigator.geolocation) {
            resolve({ latitude: null, longitude: null });
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (position) => {
              resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
              });
            },
            (error) => {
              console.warn("Coordinator geolocation acquisition failed", error);
              resolve({ latitude: null, longitude: null });
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
          );
        });
        creatorLatitude = coords.latitude;
        creatorLongitude = coords.longitude;
      } catch (err) {
        console.error("Coordinator coordinate fetch error:", err);
      }

      // 4. Create Event Document (Public info)
      const eventRef = doc(db, 'events', eventId);
      try {
        await setDoc(eventRef, {
          name: eventName.trim(),
          createdAt: serverTimestamp(),
          creatorUid: user.uid,
          creatorLatitude,
          creatorLongitude
        });
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, `events/${eventId}`);
      }

      // 4. Create Private Admin Key mapping document
      const adminKeyRef = doc(db, 'admin_keys', eventId);
      try {
        await setDoc(adminKeyRef, {
          eventId,
          adminKey,
          createdAt: serverTimestamp()
        });
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, `admin_keys/${eventId}`);
      }

      // 5. Save event to local storage so organizer can return to it
      const newEvent: LocalEvent = {
        eventId,
        adminKey,
        name: eventName.trim(),
        createdAt: new Date().toISOString()
      };
      
      const updatedEvents = [newEvent, ...myEvents];
      localStorage.setItem('attendance_tracker_events', JSON.stringify(updatedEvents));
      setMyEvents(updatedEvents);

      // 7. Clear state & navigate to admin dashboard for this event
      setEventName('');
      onNavigate(eventId, adminKey);
    } catch (err: any) {
      console.error("Error creating event:", err);
      let displayError = 'Failed to create event. Please verify your connection.';
      try {
        const parsed = JSON.parse(err.message);
        if (parsed && parsed.error) {
          displayError = `Failed to create event: ${parsed.error}`;
        }
      } catch (e) {
        if (err.message) {
          displayError = `Failed to create event: ${err.message}`;
        }
      }
      setError(displayError);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const link = `${window.location.origin}${window.location.pathname}?event=${eventId}`;
    navigator.clipboard.writeText(link);
    setCopiedId(eventId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDeleteLocalEvent = (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = myEvents.filter(ev => ev.eventId !== eventId);
    localStorage.setItem('attendance_tracker_events', JSON.stringify(updated));
    setMyEvents(updated);
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4" id="create-event-container">
      {/* Brand Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center p-3 bg-indigo-50 text-indigo-600 rounded-2xl mb-4">
          <Calendar className="w-8 h-8" id="header-calendar-icon" />
        </div>
        <h1 className="text-4xl font-extrabold font-display tracking-tight text-gray-900 mb-2">
          SyncAttendance
        </h1>
        <p className="text-gray-500 max-w-md mx-auto">
          Create frictionless check-in pages for lectures, meetups, or events, and download beautiful attendance PDFs instantly.
        </p>
      </div>

      {/* Creation Card */}
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl p-8 border border-gray-100 fancy-shadow mb-8"
        id="creation-card"
      >
        <h2 className="text-xl font-bold font-display text-gray-900 mb-4 flex items-center">
          <Plus className="w-5 h-5 text-indigo-500 mr-2" />
          Create New Session
        </h2>

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="event-name-input" className="block text-sm font-medium text-gray-700 mb-1.5">
              Event or Class Name
            </label>
            <input
              type="text"
              id="event-name-input"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g., Computer Science 101 Lecture"
              maxLength={100}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-gray-900 bg-gray-50/50"
              disabled={loading}
            />
          </div>

          <div className="flex items-start space-x-2 bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-100/50 text-xs text-indigo-700/95" id="creation-geo-notice">
            <MapPin className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              <strong>Millimeter Proximity Verifier:</strong> Your current location coordinates are securely logged as a reference token. Attendees' check-in coordinates will be compared to calculate their distance in millimeters, helping you judge attendance authenticity.
            </span>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl font-medium" id="creation-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50 flex items-center justify-center disabled:opacity-50 cursor-pointer"
            id="btn-create-event"
          >
            {loading ? (
              <span className="inline-flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Deploying Session...
              </span>
            ) : (
              'Create Session & Get Link'
            )}
          </button>
        </form>
      </motion.div>

      {/* History List */}
      {myEvents.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-3xl p-8 border border-gray-100 fancy-shadow"
          id="history-card"
        >
          <h2 className="text-lg font-bold font-display text-gray-900 mb-4 flex items-center">
            <Shield className="w-5 h-5 text-indigo-500 mr-2" />
            Your Created Sessions
          </h2>
          <div className="space-y-3" id="history-list">
            {myEvents.map((ev) => (
              <div
                key={ev.eventId}
                onClick={() => onNavigate(ev.eventId, ev.adminKey)}
                className="group flex items-center justify-between p-4 rounded-2xl border border-gray-100 hover:border-indigo-100 hover:bg-indigo-50/20 transition-all cursor-pointer"
              >
                <div className="min-w-0 flex-1 pr-4">
                  <h3 className="font-semibold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                    {ev.name}
                  </h3>
                  <p className="text-xs text-gray-400 mt-1 flex items-center">
                    <span className="font-mono">ID: {ev.eventId}</span>
                    <span className="mx-1.5">•</span>
                    <span>{new Date(ev.createdAt).toLocaleDateString()}</span>
                  </p>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    onClick={(e) => handleCopyLink(ev.eventId, e)}
                    className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                    title="Copy Check-In Link"
                  >
                    {copiedId === ev.eventId ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate(ev.eventId, ev.adminKey);
                    }}
                    className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                    title="Open Dashboard"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleDeleteLocalEvent(ev.eventId, e)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="Remove from history"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
