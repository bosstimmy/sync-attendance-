import React, { useState, useEffect } from 'react';
import { db, getOrCreateUser } from '../lib/firebase';
import { doc, getDoc, collection, onSnapshot, deleteDoc, query, orderBy, limit } from 'firebase/firestore';
import { Attendee, Event } from '../types';
import { googleSignInForGmail, getCachedGmailUser, gmailSignOut, sendAttendanceEmail } from '../lib/emailService';
import { calculateDistanceInMillimeters, formatProximity, getProximityStatus } from '../lib/geo';
import {
  ArrowLeft, Download, Copy, Check, Search, Trash2,
  Users, Calendar, Clock, AlertCircle, ShieldAlert, ExternalLink, QrCode, MapPin,
  Mail, LogOut, BookOpen, GraduationCap, Briefcase, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Spinner from './Spinner';

// Cap the live attendee subscription to protect memory/rendering on huge events.
const ATTENDEE_LIMIT = 1000;

interface DashboardProps {
  eventId: string;
  adminKey?: string;
  onNavigateHome: () => void;
}

export default function Dashboard({ eventId, adminKey: propAdminKey, onNavigateHome }: DashboardProps) {
  const getEventTypeBadge = (type?: string | null) => {
    switch (type) {
      case 'class':
        return { label: 'Class / Lecture', icon: BookOpen, className: 'bg-blue-50 border-blue-100 text-blue-700' };
      case 'school':
        return { label: 'School Activity', icon: GraduationCap, className: 'bg-purple-50 border-purple-100 text-purple-700' };
      case 'meeting':
        return { label: 'Meeting / Team', icon: Briefcase, className: 'bg-amber-50 border-amber-100 text-amber-700' };
      case 'event':
        return { label: 'Event / Seminar', icon: Sparkles, className: 'bg-rose-50 border-rose-100 text-rose-700' };
      default:
        return null;
    }
  };

  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(true);
  const [authorized, setAuthorized] = useState(false);
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
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [gmailUser, setGmailUser] = useState<any>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Check cached Gmail user session
  useEffect(() => {
    const cached = getCachedGmailUser();
    if (cached.user && cached.token) {
      setGmailUser(cached.user);
      if (cached.user.email) {
        setRecipientEmail(cached.user.email);
      }
    }
  }, [showEmailForm]);

  // Computed links
  const attendeeLink = `${window.location.origin}${window.location.pathname}?event=${eventId}`;
  const adminKeyToUse = propAdminKey || localStorage.getItem(`admin_key_${eventId}`) || '';
  const adminLink = `${window.location.origin}${window.location.pathname}?event=${eventId}&adminKey=${adminKeyToUse}`;

  // 1. Authorize: only the anonymous uid that created this event may enter.
  //    (Access is device/browser-bound — the shareable "admin link" no longer
  //    grants access on other devices, by design.)
  useEffect(() => {
    let cancelled = false;
    async function authorize() {
      setAuthorizing(true);
      setAuthError('');

      try {
        const { uid } = await getOrCreateUser();
        const snap = await getDoc(doc(db, 'events', eventId));
        if (cancelled) return;

        if (!snap.exists()) {
          setAuthError('Event not found. It may have been deleted.');
          return;
        }

        const data = snap.data();
        if (data.creatorUid !== uid) {
          setAuthError('This dashboard can only be opened on the device or browser that created the event.');
          return;
        }

        // Owner confirmed — load the owner-only reference location.
        let creatorLatitude: number | null = null;
        let creatorLongitude: number | null = null;
        try {
          const anchorSnap = await getDoc(doc(db, 'events', eventId, 'private', 'anchor'));
          if (anchorSnap.exists()) {
            creatorLatitude = anchorSnap.data().latitude ?? null;
            creatorLongitude = anchorSnap.data().longitude ?? null;
          }
        } catch (anchorErr) {
          console.error('Error loading reference location', anchorErr);
        }
        if (cancelled) return;

        setEvent({
          id: eventId,
          name: data.name,
          creatorName: data.creatorName !== undefined ? data.creatorName : null,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
          creatorUid: data.creatorUid,
          creatorLatitude,
          creatorLongitude,
          requireGender: data.requireGender !== undefined ? data.requireGender : true,
          requireMatricNumber: data.requireMatricNumber !== undefined ? data.requireMatricNumber : false,
          requireGeolocation: data.requireGeolocation !== undefined ? data.requireGeolocation : true,
          customQuestion: data.customQuestion !== undefined ? data.customQuestion : null,
          customQuestion2: data.customQuestion2 !== undefined ? data.customQuestion2 : null,
          customQuestion3: data.customQuestion3 !== undefined ? data.customQuestion3 : null,
          eventType: data.eventType !== undefined ? data.eventType : null
        });
        setAuthorized(true);
      } catch (err: any) {
        console.error("Error during authorization", err);
        if (!cancelled) setAuthError('Connection failed. Unable to authenticate session.');
      } finally {
        if (!cancelled) setAuthorizing(false);
      }
    }
    authorize();
    return () => { cancelled = true; };
  }, [eventId]);

  // 2. Listen to the attendee registry in real-time (owner-only by rules).
  useEffect(() => {
    if (!authorized) return;

    setLoading(true);

    const attendeesQuery = query(
      collection(db, 'events', eventId, 'attendees'),
      orderBy('joinedAt', 'desc'),
      limit(ATTENDEE_LIMIT)
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
          longitude: data.longitude !== undefined ? data.longitude : null,
          matricNumber: data.matricNumber !== undefined ? data.matricNumber : null,
          customResponse: data.customResponse !== undefined ? data.customResponse : null,
          customResponse2: data.customResponse2 !== undefined ? data.customResponse2 : null,
          customResponse3: data.customResponse3 !== undefined ? data.customResponse3 : null,
          deviceId: data.deviceId !== undefined ? data.deviceId : null
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

  const triggerPDFDownload = async () => {
    if (!event) return;
    const { generateAttendancePDF } = await import('../lib/pdfGenerator');
    generateAttendancePDF(
      event.name, 
      attendees, 
      event.createdAt,
      event.creatorLatitude,
      event.creatorLongitude,
      event.requireGeolocation !== false,
      event.requireGender !== false,
      event.requireMatricNumber,
      event.customQuestion,
      event.customQuestion2,
      event.customQuestion3,
      event.creatorName
    );
  };

  const handleGmailSignIn = async () => {
    setEmailError(null);
    setEmailSuccess(null);
    try {
      const result = await googleSignInForGmail();
      setGmailUser(result.user);
      if (result.user.email) {
        setRecipientEmail(result.user.email);
      }
    } catch (err: any) {
      console.error(err);
      setEmailError(err.message || 'Google authentication failed.');
    }
  };

  const handleGmailSignOut = () => {
    gmailSignOut();
    setGmailUser(null);
    setRecipientEmail('');
    setEmailSuccess(null);
    setEmailError(null);
  };

  const handleSendEmailReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !recipientEmail) return;
    
    setSendingEmail(true);
    setEmailSuccess(null);
    setEmailError(null);

    try {
      // 1. Generate the PDF document in-memory (no browser download).
      const { generateAttendancePDF } = await import('../lib/pdfGenerator');
      const doc = generateAttendancePDF(
        event.name,
        attendees,
        event.createdAt,
        event.creatorLatitude,
        event.creatorLongitude,
        event.requireGeolocation !== false,
        event.requireGender !== false,
        event.requireMatricNumber,
        event.customQuestion,
        event.customQuestion2,
        event.customQuestion3,
        event.creatorName,
        false
      );

      // Extract raw base64 data from pdf instance
      const dataUri = doc.output('datauristring');
      const pdfBase64 = dataUri.split(',')[1];

      // 2. Call our send email service
      await sendAttendanceEmail({
        recipientEmail: recipientEmail.trim(),
        eventName: event.name,
        eventDate: event.createdAt,
        creatorName: event.creatorName,
        attendees,
        pdfBase64
      });

      setEmailSuccess(`Attendance report has been successfully sent to ${recipientEmail}`);
    } catch (err: any) {
      console.error(err);
      setEmailError(err.message || 'Failed to send report. Please check your credentials or try again.');
    } finally {
      setSendingEmail(false);
    }
  };
  
  const deviceCounts = React.useMemo(() => {
    const counts: { [key: string]: number } = {};
    attendees.forEach(att => {
      if (att.deviceId) {
        counts[att.deviceId] = (counts[att.deviceId] || 0) + 1;
      }
    });
    return counts;
  }, [attendees]);

  const duplicateDeviceAttendeesCount = React.useMemo(() => {
    return attendees.filter(att => att.deviceId && deviceCounts[att.deviceId] > 1).length;
  }, [attendees, deviceCounts]);

  // Filter attendees by search query
  const filteredAttendees = attendees.filter(att => 
    att.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (att.gender && att.gender.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (att.matricNumber && att.matricNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (att.customResponse && att.customResponse.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (att.customResponse2 && att.customResponse2.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (att.customResponse3 && att.customResponse3.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Verifying ownership
  if (authorizing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-12" id="dashboard-authorizing">
        <div className="relative w-16 h-16 mb-4">
          <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin"></div>
        </div>
        <p className="text-gray-500 font-medium">Verifying dashboard access...</p>
      </div>
    );
  }

  // Not the owner of this event on this device/browser.
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
            <h2 className="text-2xl font-bold font-display text-gray-900">Dashboard Locked</h2>
            <p className="text-gray-500 text-sm mt-1">
              {authError || 'You are not authorized to view this attendance list.'}
            </p>
          </div>

          <div className="p-4 bg-gray-50/70 border border-gray-100 rounded-2xl text-xs text-gray-500 leading-relaxed mb-6">
            For your attendees' privacy, this dashboard is tied to the browser that
            created the event. Open it from that same device, or create a new session
            from this one.
          </div>

          <div className="pt-2 text-center">
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
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-extrabold font-display text-gray-900 tracking-tight">
              {event.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100 animate-pulse">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5"></span>
                Live Listening
              </span>
              {(() => {
                const badge = getEventTypeBadge(event.eventType);
                if (!badge) return null;
                const IconComponent = badge.icon;
                return (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge.className}`}>
                    <IconComponent className="w-3.5 h-3.5 mr-1" />
                    {badge.label}
                  </span>
                );
              })()}
            </div>
          </div>
          {event.creatorName && (
            <p className="text-sm font-semibold text-gray-750 mt-1.5 flex items-center">
              <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-lg text-xs font-medium mr-2 border border-indigo-100/50">
                Host
              </span>
              {event.creatorName}
            </p>
          )}
          <p className="text-sm text-gray-400 mt-1.5 flex items-center space-x-3">
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
            onClick={() => setShowEmailForm(!showEmailForm)}
            disabled={attendees.length === 0}
            className={`inline-flex items-center px-4 py-2.5 rounded-xl border font-medium transition-all text-sm cursor-pointer disabled:cursor-not-allowed ${
              showEmailForm 
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100' 
                : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700 disabled:bg-gray-50 disabled:text-gray-400'
            }`}
          >
            <Mail className="w-4.5 h-4.5 mr-1.5 text-indigo-500 disabled:text-gray-400" />
            Email Report
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

      {/* Email Report Banner/Form */}
      <AnimatePresence>
        {showEmailForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-indigo-50/50 border border-indigo-100 rounded-3xl p-6 mb-8 flex flex-col md:flex-row items-stretch gap-6"
            id="email-report-card"
          >
            {/* Left side: status/instructions */}
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900 font-display flex items-center">
                  <Mail className="w-5 h-5 mr-2 text-indigo-600 animate-pulse" />
                  Email Attendance Report
                </h3>
                <p className="text-gray-500 text-sm mt-1 max-w-xl">
                  Connect your Google Account to email this report securely using the official Gmail API. 
                  The recipient will receive a beautifully styled summary with the official PDF report attached.
                </p>
              </div>

              {gmailUser && (
                <div className="mt-4 p-3 bg-white/80 border border-indigo-100/50 rounded-xl flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    {gmailUser.photoURL ? (
                      <img src={gmailUser.photoURL} alt="Google Profile" className="w-8 h-8 rounded-full border border-indigo-200" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                        {gmailUser.displayName?.[0] || 'U'}
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-gray-850">{gmailUser.displayName}</p>
                      <p className="text-[11px] text-gray-400">{gmailUser.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleGmailSignOut}
                    className="inline-flex items-center text-xs text-red-500 hover:text-red-700 font-medium transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5 mr-1" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>

            {/* Right side: Authentication or Sender Form */}
            <div className="w-full md:w-96 bg-white rounded-2xl border border-indigo-100 p-5 flex flex-col justify-center">
              {!gmailUser ? (
                <div className="text-center py-4 flex flex-col items-center justify-center">
                  <p className="text-xs text-gray-400 font-medium mb-3">Google integration is required to send reports via Gmail.</p>
                  
                  <button
                    onClick={handleGmailSignIn}
                    className="w-full inline-flex items-center justify-center bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-300 rounded-xl px-4 py-2.5 shadow-sm text-sm transition-colors cursor-pointer"
                  >
                    <svg className="w-5 h-5 mr-3 shrink-0" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                    </svg>
                    Sign in with Google
                  </button>
                  
                  {emailError && (
                    <p className="text-[11px] text-red-500 font-medium mt-3">{emailError}</p>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSendEmailReport} className="space-y-3.5">
                  <div>
                    <label htmlFor="recipient-email-input" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Recipient's Email
                    </label>
                    <input
                      type="email"
                      id="recipient-email-input"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="e.g., manager@example.com"
                      required
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm text-gray-900 bg-gray-50/50"
                    />
                  </div>

                  <div className="flex items-center space-x-2 text-[11px] text-gray-400">
                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>
                    <span>Includes PDF Attachment (~20KB)</span>
                  </div>

                  {emailSuccess && (
                    <p className="text-[11px] text-emerald-600 font-semibold bg-emerald-50 border border-emerald-100/50 px-2.5 py-2 rounded-lg">
                      {emailSuccess}
                    </p>
                  )}

                  {emailError && (
                    <p className="text-[11px] text-red-500 font-semibold bg-red-50 border border-red-100/50 px-2.5 py-2 rounded-lg">
                      {emailError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={sendingEmail || !recipientEmail}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-100 disabled:text-gray-400 text-white font-semibold rounded-xl text-xs transition-colors flex items-center justify-center cursor-pointer shadow-sm disabled:cursor-not-allowed"
                  >
                    {sendingEmail ? 'Sending Report...' : 'Send via Gmail'}
                  </button>
                </form>
              )}
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
          <p className="text-xs text-gray-400 mt-1">Bookmark this to reopen your logs — access is tied to <span className="font-semibold text-gray-500">this browser</span> for attendee privacy.</p>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8" id="stat-cards">
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
            <MapPin className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 font-semibold tracking-wide uppercase">Reference Anchor</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">
              {event?.creatorLatitude !== null && event?.creatorLatitude !== undefined && event?.creatorLongitude !== null && event?.creatorLongitude !== undefined ? (
                <span className="font-mono text-xs">
                  {event.creatorLatitude.toFixed(5)}, {event.creatorLongitude.toFixed(5)}
                </span>
              ) : (
                'No anchor token'
              )}
            </p>
          </div>
        </div>

        <div className={`rounded-2xl border p-5 fancy-shadow flex items-center space-x-4 transition-colors ${
          duplicateDeviceAttendeesCount > 0 
            ? 'border-red-100 bg-red-50/10' 
            : 'border-gray-100 bg-white'
        }`}>
          <div className={`p-3.5 rounded-xl shrink-0 ${
            duplicateDeviceAttendeesCount > 0 
              ? 'bg-red-50 text-red-600' 
              : 'bg-gray-50 text-gray-400'
          }`}>
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold tracking-wide uppercase">Shared Devices</p>
            <p className={`text-lg font-bold mt-0.5 ${
              duplicateDeviceAttendeesCount > 0 ? 'text-red-600' : 'text-gray-500'
            }`}>
              {duplicateDeviceAttendeesCount > 0 
                ? `${duplicateDeviceAttendeesCount} sign-ins` 
                : 'None detected'
              }
            </p>
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
                  {(!event || event.requireGender !== false) && <th className="py-3 px-6">Gender</th>}
                  {event?.requireMatricNumber && <th className="py-3 px-6">Matric Number</th>}
                  {event?.customQuestion && <th className="py-3 px-6">Answer 1 ({event.customQuestion})</th>}
                  {event?.customQuestion2 && <th className="py-3 px-6">Answer 2 ({event.customQuestion2})</th>}
                  {event?.customQuestion3 && <th className="py-3 px-6">Answer 3 ({event.customQuestion3})</th>}
                  {(!event || event.requireGeolocation !== false) && <th className="py-3 px-6">In-Class Status</th>}
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
                      <td className="py-4 px-6">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-900">{att.name}</span>
                          {att.deviceId && deviceCounts[att.deviceId] > 1 && (
                            <span className="inline-flex items-center text-[10px] text-red-600 bg-red-50 border border-red-100/50 px-1.5 py-0.5 rounded-md font-medium mt-1 w-max">
                              <AlertCircle className="w-3 h-3 mr-1 shrink-0" />
                              Shared Device (Same Phone)
                            </span>
                          )}
                        </div>
                      </td>
                      {(!event || event.requireGender !== false) && (
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
                      )}
                      {event?.requireMatricNumber && (
                        <td className="py-4 px-6 font-mono text-gray-700">
                          {att.matricNumber || <span className="text-gray-400 italic text-xs">Not provided</span>}
                        </td>
                      )}
                      {event?.customQuestion && (
                        <td className="py-4 px-6 text-gray-700 max-w-[200px] truncate" title={att.customResponse || ''}>
                          {att.customResponse || <span className="text-gray-400 italic text-xs">Not provided</span>}
                        </td>
                      )}
                      {event?.customQuestion2 && (
                        <td className="py-4 px-6 text-gray-700 max-w-[200px] truncate" title={att.customResponse2 || ''}>
                          {att.customResponse2 || <span className="text-gray-400 italic text-xs">Not provided</span>}
                        </td>
                      )}
                      {event?.customQuestion3 && (
                        <td className="py-4 px-6 text-gray-700 max-w-[200px] truncate" title={att.customResponse3 || ''}>
                          {att.customResponse3 || <span className="text-gray-400 italic text-xs">Not provided</span>}
                        </td>
                      )}
                      {(!event || event.requireGeolocation !== false) && (
                        <td className="py-4 px-6">
                          {att.latitude && att.longitude ? (
                            <div className="flex flex-col space-y-1" id={`att-proximity-${att.id}`}>
                              {(() => {
                                const distMm = calculateDistanceInMillimeters(
                                  event?.creatorLatitude,
                                  event?.creatorLongitude,
                                  att.latitude,
                                  att.longitude
                                );
                                const status = getProximityStatus(distMm);
                                return (
                                  <>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${status.className}`}>
                                        {status.label}
                                      </span>
                                      {distMm !== null && (
                                        <span className="text-[11px] font-mono font-semibold text-gray-600">
                                          {formatProximity(distMm)}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-gray-400 flex items-center space-x-1.5">
                                      <span className="font-mono">Token: {att.latitude.toFixed(5)}, {att.longitude.toFixed(5)}</span>
                                      <span>•</span>
                                      <a 
                                        href={`https://www.google.com/maps?q=${att.latitude},${att.longitude}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-600 hover:text-indigo-800 hover:underline"
                                      >
                                        View Map
                                      </a>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic text-xs flex items-center space-x-1">
                              <span>⚠️</span>
                              <span>No GPS token</span>
                            </span>
                          )}
                        </td>
                      )}
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
                            <Spinner className="h-4 w-4 text-red-600" />
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
