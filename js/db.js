import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
  off,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const PLACEHOLDER = "YOUR_";

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.databaseURL &&
    !firebaseConfig.apiKey.startsWith(PLACEHOLDER)
  );
}

let app = null;
let auth = null;
let db = null;

export function initFirebase() {
  if (!isFirebaseConfigured()) return false;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
  return true;
}

export function watchAuth(callback) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function register(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function subscribeToState(uid, onData, onError) {
  const dbRef = ref(db, `users/${uid}/workspace`);
  onValue(dbRef, (snapshot) => {
    onData(snapshot.val());
  }, onError);
  // Returneaza functia de cleanup
  return () => off(dbRef, "value");
}

export async function saveStateToCloud(uid, payload) {
  const dbRef = ref(db, `users/${uid}/workspace`);
  await set(dbRef, payload);
}
