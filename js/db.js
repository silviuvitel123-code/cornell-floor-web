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

// Cloudinary config (fara Firebase Storage)
const CLOUDINARY_CLOUD = "dqsdmhfj4";
const CLOUDINARY_PRESET = "avize_cf";

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

// ── File manager via Cloudinary ──

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

function cloudinaryResourceType(file) {
  const t = (file.type || "").toLowerCase();
  const n = (file.name || "").toLowerCase();
  if (t.startsWith("image/") || n.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff)$/)) return "image";
  if (t.startsWith("video/") || n.match(/\.(mp4|mov|avi|mkv)$/)) return "video";
  return "raw"; // PDF, DOCX, DWG, XLSX etc
}

export function uploadFile(uid, siteId, chapterKey, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const resourceType = cloudinaryResourceType(file);
    // public_id scurt si sigur
    const publicId = `cf_${fileId}`;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_PRESET);
    formData.append("public_id", publicId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress && onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = async () => {
      if (xhr.status === 200) {
        const result = JSON.parse(xhr.responseText);
        const meta = {
          fileId,
          name: file.name,
          size: file.size,
          type: file.type || result.resource_type,
          uploadedAt: new Date().toISOString(),
          publicId: result.public_id,
          downloadURL: result.secure_url,
          resourceType: result.resource_type,
        };
        await set(ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}/${fileId}`), meta);
        resolve(meta);
      } else {
        reject(new Error("Upload Cloudinary eșuat: " + xhr.responseText));
      }
    };

    xhr.onerror = () => reject(new Error(`Eroare rețea (${resourceType}). Verifică conexiunea.`));
    xhr.ontimeout = () => reject(new Error("Timeout - fișierul e prea mare sau conexiunea e slabă."));
    xhr.timeout = 120000; // 2 minute timeout
    xhr.send(formData);
  });
}

export async function deleteFile(uid, siteId, chapterKey, fileId) {
  // Sterge doar din Realtime DB (metadate)
  // Fisierul ramane in Cloudinary dar nu mai e accesibil din app
  await set(ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}/${fileId}`), null);
}
