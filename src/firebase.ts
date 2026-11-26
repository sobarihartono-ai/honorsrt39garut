import { initializeApp } from 'firebase/app';
import {
  User,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const firebaseProjectId = firebaseConfig.projectId;
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const authPersistenceReady: Promise<void> = Promise.race([
  setPersistence(auth, browserLocalPersistence).catch(() => {
    // Browser or iframe blocks persistent auth storage; falls back to in-memory session
  }),
  new Promise<void>((resolve) => setTimeout(resolve, 1500)),
]);

let pendingAnonSignIn: Promise<User | null> | null = null;

export async function ensureAnonymousSession(forceNewAnon = false): Promise<User | null> {
  await authPersistenceReady;
  if (!forceNewAnon && auth.currentUser) {
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
