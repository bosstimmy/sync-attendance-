export interface Event {
  id: string;
  name: string;
  createdAt: string; // ISO string
  creatorUid: string;
}

export interface Attendee {
  id: string;
  name: string;
  gender: string;
  joinedAt: string; // ISO string
  userAgent?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface EventAdmin {
  adminKey: string;
  assignedAt: string; // ISO string
}
