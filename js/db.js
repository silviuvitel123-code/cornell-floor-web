import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const PLACEHOLDER = "YOUR_";

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
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
  db = getFirestore(app);
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
  const ref = doc(db, "users", uid, "workspace", "main");
  return onSnapshot(
    ref,
    (snapshot) => {
      onData(snapshot.exists() ? snapshot.data().payload : null);
    },
    onError
  );
}

export async function saveStateToCloud(uid, payload) {
  const ref = doc(db, "users", uid, "workspace", "main");
  await setDoc(
    ref,
    {
      payload,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function getProjectId() {
  return firebaseConfig.projectId || "";
}
