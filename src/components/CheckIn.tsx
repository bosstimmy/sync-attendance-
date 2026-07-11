import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, getOrCreateUser } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { CheckCircle2, User, Clock, AlertTriangle, ArrowLeft, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CheckInProps {
  eventId: string;
  onNavigateHome: () => void;
}

interface SavedCheckIn {
  name: string;
  gender?: string | null;
  joinedAt: string;
  matricNumber?: string | null;
  customResponse?: string | null;
  customResponse2?: string | null;
  customResponse3?: string | null;
}

export default function CheckIn({ eventId, onNavigateHome }: CheckInProps) {
  const [eventName, setEventName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [matricNumber, setMatricNumber] = useState('');
  const [customResponse, setCustomResponse] = useState('');
  const [customResponse2, setCustomResponse2] = useState('');
  const [customResponse3, setCustomResponse3] = useState('');
  const [savedCheckIn, setSavedCheckIn] = useState<SavedCheckIn | null>(null);

  const [eventConfig, setEventConfig] = useState<{
    requireGender: boolean;
    requireMatricNumber: boolean;
    requireGeolocation: boolean;
    customQuestion: string | null;
    customQuestion2: string | null;
    customQuestion3: string | null;
  }>({
    requireGender: true,
    requireMatricNumber: false,
    requireGeolocation: true,
    customQuestion: null,
    customQuestion2: null,
    customQuestion3: null
  });

  // Load event details and check local storage & Firestore for existing check-in
  useEffect(() => {
    async function init() {
      // 1. Check if already checked in locally
      let hasCheckedInLocally = false;
      const localCheckinsStr = localStorage.getItem('attendance_tracker_checkins');
      if (localCheckinsStr) {
        try {
          const localCheckins = JSON.parse(localCheckinsStr);
          if (localCheckins[eventId]) {
            setSavedCheckIn(localCheckins[eventId]);
            hasCheckedInLocally = true;
          }
        } catch (e) {
          console.error("Error reading checkins from localStorage", e);
        }
      }

      // 2. Fetch public event metadata from firestore and verify against DB
      try {
        const user = await getOrCreateUser();
        const eventDoc = await getDoc(doc(db, 'events', eventId));
        if (eventDoc.exists()) {
          const data = eventDoc.data();
          setEventName(data.name);
          const config = {
            requireGender: data.requireGender !== undefined ? data.requireGender : true,
            requireMatricNumber: data.requireMatricNumber !== undefined ? data.requireMatricNumber : false,
            requireGeolocation: data.requireGeolocation !== undefined ? data.requireGeolocation : true,
            customQuestion: data.customQuestion !== undefined ? data.customQuestion : null,
            customQuestion2: data.customQuestion2 !== undefined ? data.customQuestion2 : null,
            customQuestion3: data.customQuestion3 !== undefined ? data.customQuestion3 : null
          };
          setEventConfig(config);

          // If not found in localStorage, double check Firestore using unique browser UID
          if (!hasCheckedInLocally) {
            const attendeeDoc = await getDoc(doc(db, 'events', eventId, 'attendees', 'att_' + user.uid));
            if (attendeeDoc.exists()) {
              const attData = attendeeDoc.data();
              const joinedAtDate = attData.joinedAt?.toDate ? attData.joinedAt.toDate() : new Date();
              const restoredCheckIn: SavedCheckIn = {
                name: attData.name,
                gender: attData.gender,
                joinedAt: joinedAtDate.toISOString(),
                matricNumber: attData.matricNumber,
                customResponse: attData.customResponse,
                customResponse2: attData.customResponse2,
                customResponse3: attData.customResponse3
              };

              setSavedCheckIn(restoredCheckIn);

              // Back-fill to localStorage for fast future loads
              const localCheckins = localCheckinsStr ? JSON.parse(localCheckinsStr) : {};
              localCheckins[eventId] = restoredCheckIn;
              localStorage.setItem('attendance_tracker_checkins', JSON.stringify(localCheckins));
            }
          }
        } else {
          setError('Event not found. Please verify the URL.');
        }
      } catch (err: any) {
        console.error("Error fetching event details", err);
        setError('Connection error. Failed to retrieve event details.');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [eventId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (eventConfig.requireGender && !gender) {
      setError('Please select your gender.');
      return;
    }
    if (eventConfig.requireMatricNumber && !matricNumber.trim()) {
      setError('Please enter your matriculation number.');
      return;
    }
    if (eventConfig.customQuestion && !customResponse.trim()) {
      setError(`Please answer: "${eventConfig.customQuestion}"`);
      return;
    }
    if (eventConfig.customQuestion2 && !customResponse2.trim()) {
      setError(`Please answer: "${eventConfig.customQuestion2}"`);
      return;
    }
    if (eventConfig.customQuestion3 && !customResponse3.trim()) {
      setError(`Please answer: "${eventConfig.customQuestion3}"`);
      return;
    }

    setCheckingIn(true);
    setError('');

    try {
      // 1. Get persistent browser user ID
      const user = await getOrCreateUser();
      const attendeeId = 'att_' + user.uid;
      const attendeeRef = doc(db, 'events', eventId, 'attendees', attendeeId);

      // 2. Double-check on Firestore side to strictly prevent duplicate registration
      const checkDoc = await getDoc(attendeeRef);
      if (checkDoc.exists()) {
        setError('You have already registered for this event on this web browser.');
        setCheckingIn(false);
        return;
      }

      // 3. Retrieve geographic coordinates of registration if enabled
      let latitude: number | null = null;
      let longitude: number | null = null;

      if (eventConfig.requireGeolocation) {
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
                console.warn("Geolocation failed or denied by user", error);
                resolve({ latitude: null, longitude: null });
              },
              { enableHighAccuracy: true, timeout: 5500, maximumAge: 0 }
            );
          });
          latitude = coords.latitude;
          longitude = coords.longitude;
        } catch (geoErr) {
          console.error("Error retrieving coordinates:", geoErr);
        }
      }

      // Retrieve or generate persistent browser device identifier
      let deviceId = localStorage.getItem('attendance_tracker_device_id');
      if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('attendance_tracker_device_id', deviceId);
      }

      const currentTimeString = new Date().toISOString();

      // 4. Write check-in document securely
      try {
        await setDoc(attendeeRef, {
          name: name.trim(),
          gender: eventConfig.requireGender ? gender : null,
          joinedAt: serverTimestamp(),
          userAgent: navigator.userAgent,
          latitude: latitude,
          longitude: longitude,
          matricNumber: eventConfig.requireMatricNumber ? matricNumber.trim() : null,
          customResponse: eventConfig.customQuestion ? customResponse.trim() : null,
          customResponse2: eventConfig.customQuestion2 ? customResponse2.trim() : null,
          customResponse3: eventConfig.customQuestion3 ? customResponse3.trim() : null,
          deviceId: deviceId
        });
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, `events/${eventId}/attendees/${attendeeId}`);
      }

      // 5. Save to local storage to block duplicate entries and remember check-in
      const localCheckinData: SavedCheckIn = {
        name: name.trim(),
        gender: eventConfig.requireGender ? gender : null,
        joinedAt: currentTimeString,
        matricNumber: eventConfig.requireMatricNumber ? matricNumber.trim() : null,
        customResponse: eventConfig.customQuestion ? customResponse.trim() : null,
        customResponse2: eventConfig.customQuestion2 ? customResponse2.trim() : null,
        customResponse3: eventConfig.customQuestion3 ? customResponse3.trim() : null
      };

      const localCheckinsStr = localStorage.getItem('attendance_tracker_checkins') || '{}';
      const localCheckins = JSON.parse(localCheckinsStr);
      localCheckins[eventId] = localCheckinData;
      localStorage.setItem('attendance_tracker_checkins', JSON.stringify(localCheckins));

      setSavedCheckIn(localCheckinData);
    } catch (err: any) {
      console.error("Error signing check-in", err);
      let displayError = 'Check-in failed. Please check your internet connection.';
      try {
        const parsed = JSON.parse(err.message);
        if (parsed && parsed.error) {
          displayError = `Check-in failed: ${parsed.error}`;
        }
      } catch (e) {
        if (err.message) {
          displayError = `Check-in failed: ${err.message}`;
        }
      }
      setError(displayError);
    } finally {
      setCheckingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-12" id="check-in-loading">
        <div className="relative w-16 h-16 mb-4">
          <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin"></div>
        </div>
        <p className="text-gray-500 font-medium">Validating event details...</p>
      </div>
    );
  }

  if (error || !eventName) {
    return (
      <div className="max-w-md mx-auto py-12 px-4" id="check-in-error-view">
        <div className="bg-white rounded-3xl p-8 border border-gray-100 fancy-shadow text-center">
          <div className="inline-flex items-center justify-center p-3.5 bg-red-50 text-red-600 rounded-2xl mb-4">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold font-display text-gray-900 mb-2">Check-In Failed</h2>
          <p className="text-gray-500 mb-6">{error || 'Unable to access this session.'}</p>
          <button
            onClick={onNavigateHome}
            className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-xl transition-all cursor-pointer inline-flex items-center"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go to Portal Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-12 px-4" id="check-in-main-view">
      <AnimatePresence mode="wait">
        {savedCheckIn ? (
          // SUCCESS state (already checked in)
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="bg-white rounded-3xl p-8 border border-gray-100 fancy-shadow text-center"
            id="check-in-success-card"
          >
            <div className="inline-flex items-center justify-center p-4 bg-emerald-50 text-emerald-600 rounded-full mb-5">
              <CheckCircle2 className="w-12 h-12" id="check-success-icon" />
            </div>
            
            <h1 className="text-3xl font-extrabold font-display text-gray-900 mb-1">
              Checked In!
            </h1>
            <p className="text-emerald-600 font-medium text-sm mb-6">
              Your attendance has been registered successfully.
            </p>

            {/* Event Name Bubble */}
            <div className="bg-gray-50/70 border border-gray-100 rounded-2xl p-5 text-left mb-6 space-y-3">
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Event Name</p>
                <p className="text-base font-bold text-gray-900 mt-0.5">{eventName}</p>
              </div>
              <div className="flex items-center justify-between pt-2.5 border-t border-gray-100/80">
                <div className="flex flex-col space-y-1.5 text-left">
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-indigo-500" />
                    <span className="text-sm font-bold text-gray-700 truncate max-w-[150px]">{savedCheckIn.name}</span>
                  </div>
                  {savedCheckIn.gender && (
                    <p className="text-xs text-gray-500 pl-6 font-medium">
                      <span className="text-gray-400 font-semibold uppercase text-[10px]">Gender:</span> {savedCheckIn.gender}
                    </p>
                  )}
                  {savedCheckIn.matricNumber && (
                    <p className="text-xs text-gray-500 pl-6 font-medium">
                      <span className="text-gray-400 font-semibold uppercase text-[10px]">Matric No:</span> {savedCheckIn.matricNumber}
                    </p>
                  )}
                  {savedCheckIn.customResponse && (
                    <p className="text-xs text-gray-500 pl-6 font-medium">
                      <span className="text-gray-400 font-semibold uppercase text-[10px]">Answer 1:</span> {savedCheckIn.customResponse}
                    </p>
                  )}
                  {savedCheckIn.customResponse2 && (
                    <p className="text-xs text-gray-500 pl-6 font-medium">
                      <span className="text-gray-400 font-semibold uppercase text-[10px]">Answer 2:</span> {savedCheckIn.customResponse2}
                    </p>
                  )}
                  {savedCheckIn.customResponse3 && (
                    <p className="text-xs text-gray-500 pl-6 font-medium">
                      <span className="text-gray-400 font-semibold uppercase text-[10px]">Answer 3:</span> {savedCheckIn.customResponse3}
                    </p>
                  )}
                </div>
                <div className="flex items-center space-x-1.5 text-xs text-gray-450 shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{new Date(savedCheckIn.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-400 max-w-xs mx-auto mb-6 leading-relaxed">
              You can close this tab or page safely. The organizer has access to your attendance logs.
            </p>

            <button
              onClick={onNavigateHome}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer"
            >
              Need to host your own event? Go to main portal
            </button>
          </motion.div>
        ) : (
          // Check-In Form Screen
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-white rounded-3xl p-8 border border-gray-100 fancy-shadow"
            id="check-in-form-card"
          >
            <div className="mb-6">
              <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-full uppercase tracking-wider">
                Attendee Check-In
              </span>
              <h1 className="text-2xl font-bold font-display text-gray-900 mt-2">
                Join Event
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                Enter your details to confirm your attendance.
              </p>
            </div>

            {/* Event Preview banner */}
            <div className="p-4 bg-indigo-50/40 rounded-2xl border border-indigo-100/40 mb-6 flex items-start space-x-3">
              <div className="p-2 bg-white rounded-xl shadow-sm text-indigo-600 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-indigo-500 font-semibold tracking-wider uppercase">Active Session</p>
                <h3 className="font-bold text-gray-900 leading-tight mt-0.5">{eventName}</h3>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="attendee-name-input" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Your Full Name
                </label>
                <input
                  type="text"
                  id="attendee-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Jane Watson"
                  maxLength={100}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-gray-900 bg-gray-50/50"
                  disabled={checkingIn}
                  autoComplete="name"
                  required
                />
              </div>

              {eventConfig.requireGender && (
                <div>
                  <label htmlFor="attendee-gender-select" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Gender
                  </label>
                  <select
                    id="attendee-gender-select"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-gray-900 bg-gray-50/50 cursor-pointer"
                    disabled={checkingIn}
                    required
                  >
                    <option value="" disabled>Select your gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-Binary">Non-Binary</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>
              )}

              {eventConfig.requireMatricNumber && (
                <div>
                  <label htmlFor="attendee-matric-input" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Class Matriculation Number
                  </label>
                  <input
                    type="text"
                    id="attendee-matric-input"
                    value={matricNumber}
                    onChange={(e) => setMatricNumber(e.target.value)}
                    placeholder="e.g., MAT-2026-8941"
                    maxLength={50}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-gray-900 bg-gray-50/50"
                    disabled={checkingIn}
                    required
                  />
                </div>
              )}

              {eventConfig.customQuestion && (
                <div>
                  <label htmlFor="attendee-custom-input" className="block text-sm font-medium text-gray-700 mb-1.5">
                    {eventConfig.customQuestion}
                  </label>
                  <input
                    type="text"
                    id="attendee-custom-input"
                    value={customResponse}
                    onChange={(e) => setCustomResponse(e.target.value)}
                    placeholder="Type your response here..."
                    maxLength={150}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-gray-900 bg-gray-50/50"
                    disabled={checkingIn}
                    required
                  />
                </div>
              )}

              {eventConfig.customQuestion2 && (
                <div>
                  <label htmlFor="attendee-custom-input-2" className="block text-sm font-medium text-gray-700 mb-1.5">
                    {eventConfig.customQuestion2}
                  </label>
                  <input
                    type="text"
                    id="attendee-custom-input-2"
                    value={customResponse2}
                    onChange={(e) => setCustomResponse2(e.target.value)}
                    placeholder="Type your response here..."
                    maxLength={150}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-gray-900 bg-gray-50/50"
                    disabled={checkingIn}
                    required
                  />
                </div>
              )}

              {eventConfig.customQuestion3 && (
                <div>
                  <label htmlFor="attendee-custom-input-3" className="block text-sm font-medium text-gray-700 mb-1.5">
                    {eventConfig.customQuestion3}
                  </label>
                  <input
                    type="text"
                    id="attendee-custom-input-3"
                    value={customResponse3}
                    onChange={(e) => setCustomResponse3(e.target.value)}
                    placeholder="Type your response here..."
                    maxLength={150}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-gray-900 bg-gray-50/50"
                    disabled={checkingIn}
                    required
                  />
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl font-medium" id="checkin-error">
                  {error}
                </div>
              )}

              {eventConfig.requireGeolocation && (
                <div className="flex items-start space-x-2 bg-gray-50/50 p-3 rounded-xl border border-gray-100/50 text-xs text-gray-500">
                  <MapPin className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    Your geographic coordinates will be requested and recorded to validate the attendance location.
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={checkingIn}
                className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50 flex items-center justify-center disabled:opacity-50 cursor-pointer"
                id="btn-confirm-check-in"
              >
                {checkingIn ? (
                  <span className="inline-flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Registering attendance...
                  </span>
                ) : (
                  'Submit Check-In'
                )}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
