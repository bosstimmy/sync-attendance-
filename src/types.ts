export interface Event {
  id: string;
  name: string;
  creatorName?: string | null;
  createdAt: string; // ISO string
  creatorUid: string;
  creatorLatitude?: number | null;
  creatorLongitude?: number | null;
  requireGender?: boolean;
  requireMatricNumber?: boolean;
  requireGeolocation?: boolean;
  customQuestion?: string | null;
  customQuestion2?: string | null;
  customQuestion3?: string | null;
  eventType?: string | null;
}

export interface Attendee {
  id: string;
  name: string;
  gender?: string | null;
  joinedAt: string; // ISO string
  userAgent?: string;
  latitude?: number | null;
  longitude?: number | null;
  matricNumber?: string | null;
  customResponse?: string | null;
  customResponse2?: string | null;
  customResponse3?: string | null;
  deviceId?: string | null;
}

export interface EventAdmin {
  adminKey: string;
  assignedAt: string; // ISO string
}
