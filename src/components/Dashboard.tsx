import React, { useState, useEffect } from 'react';
import { db, getOrCreateUser } from '../lib/firebase';
import { doc, getDoc, collection, onSnapshot, setDoc, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { Attendee, Event } from '../types';
import { generateAttendancePDF } from '../lib/pdfGenerator';
import { 
  ArrowLeft, Download, Share2, Copy, Check, Search, Trash2, 
  Users, Calendar, Clock, AlertCircle, ShieldAlert, ShieldCheck, ExternalLink, QrCode, MapPin
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DashboardProps {
  eventId: string;
  adminKey?: string;
  onNavigateHome: () => void;
}

export default function Dashboard({ eventId, adminKey: propAdminKey, onNavigateHome }: DashboardProps) {
  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  
  // Admin Key validation input (in case they don't have it in URL)
  const [inputAdminKey, setInputAdminKey] = useState('');
  const [authError, setAuthError] = useState('');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  
  // Copied states
  const [copiedAttendee, setCopiedAttendee] = useState(false);
  const [copiedAdmin, setCopiedAdmin] = useState(false);
  
  // Active action states
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // Computed links
  const attendeeLink = `${window.location.origin}${window.location.pathname}?event=${eventId}`;
  const adminKeyToUse = propAdminKey || localStorage.getItem(`admin_key_${eventId}`) || '';
  const adminLink = `${window.location.origin}${window.location.pathname}?event=${eventId}&adminKey=${adminKeyToUse}`;

  // 1. Authorize user as Admin
  useEffect(() => {
    async function authorize() {
      setAuthorizing(true);
      setAuthError('');
      
      try {
        const keyToTry = propAdminKey || localStorage.getItem(`admin_key_${eventId}`);
        if (keyToTry) {
          const adminKeyDocRef = doc(db, 'admin_keys', eventId);
          const adminKeyDocSnap = await getDoc(adminKeyDocRef);

          if (adminKeyDocSnap.exists()) {
            const actualAdminKey = adminKeyDocSnap.data().adminKey;
            if (keyToTry === actualAdminKey) {
              setAuthorized(true);
              localStorage.setItem(`admin_key_${eventId}`, keyToTry);
            } else {
              setAuthError('Supplied admin key is incorrect.');
            }
          } else {
            setAuthError('Event administration credentials not found.');
          }
        } else {
          setAuthError('Admin authentication required.');
        }
      } catch (err: any) {
        console.error("Error during authorization", err);
        setAuthError('Connection failed. Unable to authenticate session.');
      } finally {
        setAuthorizing(false);
      }
    }
    authorize();
  }, [eventId, propAdminKey]);

  // 2. Fetch event info and listen to attendees list in real-time
  useEffect(() => {
    if (!authorized) return;

    setLoading(true);

    // Fetch Event public details
    const eventRef = doc(db, 'events', eventId);
    getDoc(eventRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setEvent({
          id: eventId,
          name: data.name,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
          creatorUid: data.creatorUid
        });
      }
    }).catch(err => console.error("Error loading event doc", err));

    // Listen to real-time attendee list
    const attendeesQuery = query(
      collection(db, 'events', eventId, 'attendees'),
      orderBy('joinedAt', 'desc')
    );

    const unsubscribe = onSnapshot(attendeesQuery, (snapshot) => {
      const list: Attendee[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        list.push({
          id: doc.id,
          name: data.name,
          gender: data.gender || 'Not specified',
          joinedAt: data.joinedAt?.toDate ? data.joinedAt.toDate().toISOString() : new Date().toISOString(),
          userAgent: data.userAgent,
          latitude: data.latitude !== undefined ? data.latitude : null,
          longitude: data.longitude !== undefined ? data.longitude : null
        });
      });
      setAttendees(list);
      setLoading(false);
    }, (err) => {
      console.error("Snapshot error:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [eventId, authorized]);

  // Handle manual admin key submission
  const handleManualAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputAdminKey.trim()) {
      setAuthError('Please enter an admin key.');
      return;
    }

    setAuthorizing(true);
    setAuthError('');

    try {
      const adminKeyDocRef = doc(db, 'admin_keys', eventId);
      const adminKeyDocSnap = await getDoc(adminKeyDocRef);

      if (adminKeyDocSnap.exists()) {
        const actualAdminKey = adminKeyDocSnap.data().adminKey;
        if (inputAdminKey.trim() === actualAdminKey) {
          setAuthorized(true);
          localStorage.setItem(`admin_key_${eventId}`, inputAdminKey.trim());
        } else {
          setAuthError('Incorrect Admin Key. Please verify the code and try again.');
        }
      } else {
        setAuthError('Event administration credentials not found.');
      }
    } catch (err: any) {
      console.error("Error verifying manual key", err);
      setAuthError('Incorrect Admin Key. Please verify the code and try again.');
    } finally {
      setAuthorizing(false);
    }
  };

  const handleCopyAttendeeLink = () => {
    navigator.clipboard.writeText(attendeeLink);
    setCopiedAttendee(true);
    setTimeout(() => setCopiedAttendee(false), 2000);
  };

  const handleCopyAdminLink = () => {
    navigator.clipboard.writeText(adminLink);
    setCopiedAdmin(true);
    setTimeout(() => setCopiedAdmin(false), 2000);
  };

  const handleDeleteAttendee = async (attendeeId: string) => {
    if (!window.confirm('Are you sure you want to remove this attendee?')) return;
    setDeletingId(attendeeId);
    try {
      await deleteDoc(doc(db, 'events', eventId, 'attendees', attendeeId));
    } catch (err) {
      console.error("Error deleting attendee", err);
      alert('Failed to delete. Make sure you are authorized.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteEvent = async () => {
    if (!window.confirm('WARNING: This will permanently delete the event session. Attendees will no longer be able to check in. Continue?')) return;
    setDeletingEvent(true);
    try {
      // 1. Delete event doc
      await deleteDoc(doc(db, 'events', eventId));
      
      // 2. Remove from local storage history
      const saved = localStorage.getItem('attendance_tracker_events');
      if (saved) {
        const events = JSON.parse(saved).filter((ev: any) => ev.eventId !== eventId);
        localStorage.setItem('attendance_tracker_events', JSON.stringify(events));
      }

      onNavigateHome();
    } catch (err) {
      console.error("Error deleting event", err);
      alert('Failed to delete event. Admin credentials required.');
    } finally {
      setDeletingEvent(false);
    }
  };

  const triggerPDFDownload = () => {
    if (!event) return;
    generateAttendancePDF(event.name, attendees, event.createdAt);
  };

  // Filter attendees by search query
  const filteredAttendees = attendees.filter(att => 
    att.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (att.gender && att.gender.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Authentication Interface
  if (!authorized) {
    return (
      <div className="max-w-md mx-auto py-12 px-4" id="dashboard-auth-screen">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-8 border border-gray-100 fancy-shadow"
        >
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center p-3 bg-amber-50 text-amber-600 rounded-2xl mb-4">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold font-display text-gray-900">Admin Lock</h2>
            <p className="text-gray-500 text-sm mt-1">
              You must supply the secure Admin Key to access this attendance list.
            </p>
          </div>

          <form onSubmit={handleManualAuth} className="space-y-4">
            <div>
              <label htmlFor="admin-key-input" className="block text-sm font-medium text-gray-700 mb-1.5">
                Admin Key or Secret
              </label>
              <input
                type="text"
                id="admin-key-input"
                value={inputAdminKey}
                onChange={(e) => setInputAdminKey(e.target.value)}
                placeholder="e.g., adm_xxxxxxxxx"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-gray-900 bg-gray-50/50 text-center font-mono"
                disabled={authorizing}
              />
            </div>

            {authError && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl font-medium text-center">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authorizing}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50 flex items-center justify-center disabled:opacity-50 cursor-pointer"
            >
              {authorizing ? 'Verifying Key...' : 'Unlock Dashboard'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-gray-100 text-center">
            <button
              onClick={onNavigateHome}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 flex items-center justify-center mx-auto transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Return to Portal Home
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Loading Dashboard
  if (loading || !event) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-12" id="dashboard-loading">
        <div className="relative w-16 h-16 mb-4">
          <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin"></div>
        </div>
        <p className="text-gray-500 font-medium">Securing connection and loading logs...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4" id="dashboard-main">
      {/* Navigation and Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <button
            onClick={onNavigateHome}
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-indigo-600 transition-colors mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to Portal
          </button>
          <div className="flex items-center space-x-2">
            <h1 className="text-3xl font-extrabold font-display text-gray-900 tracking-tight">
              {event.name}
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100 animate-pulse">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5"></span>
              Live Listening
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-1 flex items-center space-x-3">
            <span className="flex items-center">
              <Calendar className="w-3.5 h-3.5 mr-1" />
              Created {new Date(event.createdAt).toLocaleDateString()} at {new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span>•</span>
            <span className="font-mono text-xs text-indigo-500">ID: {event.id}</span>
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={triggerPDFDownload}
            disabled={attendees.length === 0}
            className="inline-flex items-center px-4.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-100 disabled:text-gray-400 text-white font-medium rounded-xl shadow-sm transition-all text-sm cursor-pointer disabled:cursor-not-allowed"
          >
            <Download className="w-4.5 h-4.5 mr-2" />
            Export to PDF
          </button>
          
          <button
            onClick={() => setShowQR(!showQR)}
            className="inline-flex items-center px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium rounded-xl transition-all text-sm cursor-pointer"
          >
            <QrCode className="w-4.5 h-4.5 mr-1.5 text-indigo-500" />
            QR Code
          </button>

          <button
            onClick={handleDeleteEvent}
            disabled={deletingEvent}
            className="inline-flex items-center px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 font-medium rounded-xl transition-all text-sm cursor-pointer"
          >
            <Trash2 className="w-4.5 h-4.5 mr-1.5" />
            Delete Event
          </button>
        </div>
      </div>

      {/* QR Code Overlay/Card */}
      <AnimatePresence>
        {showQR && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-indigo-50/50 border border-indigo-100 rounded-3xl p-6 mb-8 flex flex-col md:flex-row items-center gap-6"
            id="qr-code-card"
          >
            <div className="bg-white p-3.5 rounded-2xl border border-indigo-100/40 shadow-sm shrink-0">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(attendeeLink)}`}
                alt="Event QR Code"
                referrerPolicy="no-referrer"
                className="w-36 h-36"
              />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h3 className="text-lg font-bold text-gray-900 font-display">Attendee QR Code</h3>
              <p className="text-gray-500 text-sm mt-1 max-w-xl">
                Display this QR code in your class, presentation, or meeting room. Attendees can scan this using their phone camera to instantly jump to the check-in form.
              </p>
              <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-2">
                <a 
                  href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(attendeeLink)}`}
                  target="_blank" 
                  rel="noreferrer"
                  className="inline-flex items-center text-xs font-semibold text-indigo-600 bg-white border border-indigo-100 px-3.5 py-2 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                  Open High-Res QR
                </a>
                <button
                  onClick={() => setShowQR(false)}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-3.5 py-2"
                >
                  Hide Banner
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Link Distribution Box */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8" id="link-boxes">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 fancy-shadow">
          <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">Attendee Check-In Link</p>
          <p className="text-xs text-gray-400 mt-1">Share this with your attendees, students, or guest list.</p>
          <div className="mt-3 flex items-center space-x-2 bg-gray-50 p-2.5 rounded-xl border border-gray-200/50">
            <span className="font-mono text-xs text-gray-600 truncate flex-1">{attendeeLink}</span>
            <button
              onClick={handleCopyAttendeeLink}
              className="p-2 bg-white text-gray-500 hover:text-indigo-600 rounded-lg shadow-sm border border-gray-200/50 transition-colors cursor-pointer"
            >
              {copiedAttendee ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 fancy-shadow">
          <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Admin Dashboard Link</p>
          <p className="text-xs text-gray-400 mt-1">Keep this private. Bookmark or copy to open this logs page on other devices.</p>
          <div className="mt-3 flex items-center space-x-2 bg-gray-50 p-2.5 rounded-xl border border-gray-200/50">
            <span className="font-mono text-xs text-gray-600 truncate flex-1">{adminLink}</span>
            <button
              onClick={handleCopyAdminLink}
              className="p-2 bg-white text-gray-500 hover:text-amber-600 rounded-lg shadow-sm border border-gray-200/50 transition-colors cursor-pointer"
            >
              {copiedAdmin ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Numerical Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" id="stat-cards">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 fancy-shadow flex items-center space-x-4">
          <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-xl shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold tracking-wide uppercase">Total Attendees</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{attendees.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 fancy-shadow flex items-center space-x-4">
          <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-xl shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold tracking-wide uppercase">Latest Sign-In</p>
            <p className="text-lg font-bold text-gray-900 truncate mt-0.5">
              {attendees.length > 0 
                ? new Date(attendees[0].joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'No check-ins'
              }
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 fancy-shadow flex items-center space-x-4">
          <div className="p-3.5 bg-amber-50 text-amber-600 rounded-xl shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold tracking-wide uppercase">Security Status</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">Secure Firestore Auth</p>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-3xl border border-gray-100 fancy-shadow overflow-hidden" id="attendee-table-card">
        {/* Table Header / Toolbar */}
        <div className="px-6 py-5 border-b border-gray-50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <h2 className="text-lg font-bold font-display text-gray-900 flex items-center w-full sm:w-auto">
            Attendee Registry
            <span className="ml-2.5 px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600 rounded-md">
              {filteredAttendees.length} entries
            </span>
          </h2>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 focus:border-indigo-500 focus:outline-none rounded-xl text-sm text-gray-900"
            />
          </div>
        </div>

        {/* Table Content */}
        {filteredAttendees.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100/80 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="py-3 px-6 text-center w-12">#</th>
                  <th className="py-3 px-6">Name</th>
                  <th className="py-3 px-6">Gender</th>
                  <th className="py-3 px-6">Location</th>
                  <th className="py-3 px-6">Join Time</th>
                  <th className="py-3 px-6">Join Date</th>
                  <th className="py-3 px-6 text-right w-20 pr-8">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredAttendees.map((att, idx) => {
                  const joinTime = new Date(att.joinedAt);
                  return (
                    <tr 
                      key={att.id}
                      className="group hover:bg-gray-50/30 transition-colors text-sm text-gray-800"
                    >
                      <td className="py-4 px-6 text-center text-gray-400 font-mono text-xs">
                        {filteredAttendees.length - idx}
                      </td>
                      <td className="py-4 px-6 font-semibold text-gray-900">
                        {att.name}
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          att.gender === 'Male' ? 'bg-blue-50/70 text-blue-700 border-blue-100/50' :
                          att.gender === 'Female' ? 'bg-pink-50/70 text-pink-700 border-pink-100/50' :
                          att.gender === 'Non-Binary' ? 'bg-purple-50/70 text-purple-700 border-purple-100/50' :
                          att.gender === 'Other' ? 'bg-indigo-50/70 text-indigo-700 border-indigo-100/50' :
                          'bg-gray-50/70 text-gray-600 border-gray-200/40'
                        }`}>
                          {att.gender || 'Not specified'}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        {att.latitude && att.longitude ? (
                          <a 
                            href={`https://www.google.com/maps?q=${att.latitude},${att.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 hover:underline transition-colors font-medium bg-indigo-50/50 px-2 py-1 rounded-lg border border-indigo-100/40 text-xs"
                            title={`Coords: ${att.latitude.toFixed(5)}, ${att.longitude.toFixed(5)}`}
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            <span>Map Pin</span>
                          </a>
                        ) : (
                          <span className="text-gray-400 italic text-xs">Not shared</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-gray-600">
                        {joinTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-4 px-6 text-gray-400">
                        {joinTime.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="py-4 px-6 text-right pr-8">
                        <button
                          onClick={() => handleDeleteAttendee(att.id)}
                          disabled={deletingId === att.id}
                          className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Delete attendee"
                        >
                          {deletingId === att.id ? (
                            <svg className="animate-spin h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center">
            <div className="inline-flex items-center justify-center p-3 bg-gray-50 text-gray-400 rounded-2xl mb-3">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-gray-900 font-display">No Attendees Found</h3>
            <p className="text-gray-500 text-sm mt-0.5 max-w-xs mx-auto leading-relaxed">
              {searchQuery ? "No results match your search criteria." : "Share the attendee check-in link above to start collecting attendance logs."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
