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
  get,
  onValue,
  off,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const PLACEHOLDER = "YOUR_";
const GOOGLE_CLIENT_ID = "138240724620-9otfepodaqnf7eg1snvodnm0iaokvigb.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

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
  return () => off(dbRef, "value");
}

export async function saveStateToCloud(uid, payload) {
  const dbRef = ref(db, `users/${uid}/workspace`);
  await set(dbRef, payload);
}

// ── Google Drive ──

let _driveToken = null;
let _tokenClient = null;

function getTokenClient() {
  if (_tokenClient) return _tokenClient;
  if (!window.google) throw new Error("Google Identity Services nu s-a incarcat.");
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: () => {},
  });
  return _tokenClient;
}

export function getDriveToken() {
  return new Promise((resolve, reject) => {
    if (_driveToken && _driveToken.expiresAt > Date.now()) {
      return resolve(_driveToken.token);
    }
    const client = getTokenClient();
    client.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error));
      _driveToken = {
        token: resp.access_token,
        expiresAt: Date.now() + (resp.expires_in - 60) * 1000,
      };
      resolve(resp.access_token);
    };
    client.requestAccessToken({ prompt: _driveToken ? "" : "consent" });
  });
}

async function ensureDriveFolder(uid, token) {
  // Verifica daca avem deja folder ID salvat
  const snap = await get(ref(db, `users/${uid}/driveSetup/folderId`));
  if (snap.val()) return snap.val();

  // Creaza folderul "Cornell's Floor"
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Cornell's Floor",
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const folder = await res.json();
  await set(ref(db, `users/${uid}/driveSetup/folderId`), folder.id);
  return folder.id;
}

// ── Progress tracker ──
export function subscribeToProgress(uid, siteId, onData, onError) {
  const dbRef = ref(db, `users/${uid}/siteProgress/${siteId}`);
  onValue(dbRef, (snap) => onData(snap.val() || {}), onError || (() => {}));
  return () => off(dbRef, 'value');
}

export async function saveProgress(uid, siteId, data) {
  await set(ref(db, `users/${uid}/siteProgress/${siteId}`), data);
}

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

export async function uploadFile(uid, siteId, chapterKey, file, onProgress) {
  const token = await getDriveToken();
  const folderId = await ensureDriveFolder(uid, token);

  const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Upload multipart catre Google Drive
  const metadata = JSON.stringify({
    name: file.name,
    parents: [folderId],
  });

  const form = new FormData();
  form.append("metadata", new Blob([metadata], { type: "application/json" }));
  form.append("file", file);

  // Folosim XHR pentru progress
  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink,webContentLink");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress && onProgress(Math.round(e.loaded / e.total * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error("Upload Drive eșuat: " + xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error("Eroare rețea la upload Drive."));
    xhr.send(form);
  });

  // Seteaza permisiunea de citire publica (pentru preview)
  await fetch(`https://www.googleapis.com/drive/v3/files/${result.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  const meta = {
    fileId,
    driveId: result.id,
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedAt: new Date().toISOString(),
    downloadURL: `https://drive.google.com/uc?export=download&id=${result.id}`,
    viewURL: `https://drive.google.com/file/d/${result.id}/view`,
    previewURL: `https://drive.google.com/file/d/${result.id}/preview`,
  };

  await set(ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}/${fileId}`), meta);
  return meta;
}

export async function deleteFile(uid, siteId, chapterKey, fileId, driveId) {
  if (driveId) {
    try {
      const token = await getDriveToken();
      await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }
  await set(ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}/${fileId}`), null);
}
