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

export async function uploadFile(uid, siteId, chapterKey, file, onProgress) {
  const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const resourceType = cloudinaryResourceType(file);
  const publicId = `cf_${fileId}`;

  // Folosim XHR pentru progress real, cu fallback la fetch
  const uploadResult = await new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_PRESET);
    formData.append("public_id", publicId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress && onProgress(Math.round(e.loaded / e.total * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        // Incearca cu /auto daca /raw a esuat
        const fallback = new XMLHttpRequest();
        fallback.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`);
        const fd2 = new FormData();
        fd2.append("file", file);
        fd2.append("upload_preset", CLOUDINARY_PRESET);
        fd2.append("public_id", publicId + "_a");
        fallback.onload = () => {
          if (fallback.status === 200) resolve(JSON.parse(fallback.responseText));
          else reject(new Error("Upload eșuat: " + fallback.responseText));
        };
        fallback.onerror = () => reject(new Error("Eroare rețea. Verifică conexiunea și încearcă din nou."));
        fallback.send(fd2);
      }
    };

    xhr.onerror = () => {
      // Fallback la fetch
      const fd2 = new FormData();
      fd2.append("file", file);
      fd2.append("upload_preset", CLOUDINARY_PRESET);
      fd2.append("public_id", publicId + "_b");
      fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`, { method: "POST", body: fd2 })
        .then(r => r.json())
        .then(result => {
          if (result.secure_url) resolve(result);
          else reject(new Error(result.error?.message || "Upload eșuat"));
        })
        .catch(e => reject(new Error("Eroare rețea: " + e.message)));
    };

    xhr.send(formData);
  });

  const meta = {
    fileId,
    name: file.name,
    size: file.size,
    type: file.type || uploadResult.resource_type,
    uploadedAt: new Date().toISOString(),
    publicId: uploadResult.public_id,
    downloadURL: uploadResult.secure_url,
    resourceType: uploadResult.resource_type,
  };
  await set(ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}/${fileId}`), meta);
  return meta;
}

export async function deleteFile(uid, siteId, chapterKey, fileId) {
  // Sterge doar din Realtime DB (metadate)
  // Fisierul ramane in Cloudinary dar nu mai e accesibil din app
  await set(ref(db, `users/${uid}/siteFiles/${siteId}/${chapterKey}/${fileId}`), null);
}
