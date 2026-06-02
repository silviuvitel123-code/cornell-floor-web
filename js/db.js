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
import {
  getStorage,
  ref as sRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
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
let storage = null;

export function initFirebase() {
  if (!isFirebaseConfigured()) return false;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
  storage = getStorage(app);
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
  return () => off(dbRef, "value");
}

export async function saveStateToCloud(uid, payload) {
  const dbRef = ref(db, `users/${uid}/workspace`);
  await set(dbRef, payload);
}

// ── File manager ──

export function subscribeToFiles(uid, siteId, chapterKey, onFiles, onError) {
  const dbRef = ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}`);
  onValue(dbRef, (snap) => {
    const data = snap.val() || {};
    const files = Object.values(data).sort((a, b) =>
      new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );
    onFiles(files);
  }, onError || (() => {}));
  return () => off(dbRef, "value");
}

export function uploadFile(uid, siteId, chapterKey, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, "_");
    const path = `users/${uid}/${siteId}/${chapterKey}/${fileId}_${safeName}`;
    const fileRef = sRef(storage, path);
    const task = uploadBytesResumable(fileRef, file);

    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress && onProgress(pct);
      },
      reject,
      async () => {
        const downloadURL = await getDownloadURL(task.snapshot.ref);
        const meta = {
          fileId,
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          uploadedAt: new Date().toISOString(),
          storagePath: path,
          downloadURL,
        };
        await set(ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}/${fileId}`), meta);
        resolve(meta);
      }
    );
  });
}

export async function deleteFile(uid, siteId, chapterKey, fileId, storagePath) {
  await deleteObject(sRef(storage, storagePath));
  await set(ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}/${fileId}`), null);
}
