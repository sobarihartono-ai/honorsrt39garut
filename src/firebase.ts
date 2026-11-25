import { initializeApp } from 'firebase/app';
import {
  User,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const firebaseProjectId = firebaseConfig.projectId;
export const auth = getAuth(app);

export const authPersistenceReady: Promise<void> = setPersistence(
  auth,
  browserLocalPersistence
).catch(() => {
  // Browser or iframe blocks persistent auth storage; falls back to in-memory session
});

let pendingAnonSignIn: Promise<User | null> | null = null;

export async function ensureAnonymousSession(): Promise<User | null> {
  await authPersistenceReady;
  if (auth.currentUser) {
    return auth.currentUser;
  }
  if (!pendingAnonSignIn) {
    pendingAnonSignIn = signInAnonymously(auth)
      .then((cred) => cred.user)
      .finally(() => {
        pendingAnonSignIn = null;
      });
  }
  return pendingAnonSignIn;
}
