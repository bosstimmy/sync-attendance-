import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import config from '../../firebase-applet-config.json';

// Initialize Firebase with the auto-generated config
export const app = initializeApp(config);

export const db = getFirestore(app, (config as any).firestoreDatabaseId || '(default)');

// Shared auth instance (also reused by the Gmail email service).
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errMessage = error instanceof Error ? error.message : String(error);
  // Structured log for debugging; the thrown Error carries a clean message.
  console.error('Firestore Error:', JSON.stringify({
    error: errMessage,
    operationType,
    path,
    uid: auth.currentUser?.uid ?? null,
    isAnonymous: auth.currentUser?.isAnonymous ?? null,
  }));
  throw new Error(errMessage);
}

// Ensures a Firebase user exists, signing in anonymously if needed.
// Anonymous auth gives every browser a stable, real uid that Firestore rules
// can trust for ownership checks. The uid persists across reloads on the device.
let authPromise: Promise<User> | null = null;
export function ensureAuth(): Promise<User> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!authPromise) {
    authPromise = new Promise<User>((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsub();
          resolve(user);
        } else {
          signInAnonymously(auth).catch((err) => {
            unsub();
            authPromise = null;
            reject(err);
          });
        }
      });
    });
  }
  return authPromise;
}

// Returns the current user's identity, establishing anonymous auth on first use.
export async function getOrCreateUser() {
  const user = await ensureAuth();
  return { uid: user.uid };
}

// Cryptographically strong, URL-safe identifier (matches the ^[a-zA-Z0-9_-]+$
// constraint enforced by the Firestore rules).
export function secureId(prefix: string, length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return prefix + out;
}
