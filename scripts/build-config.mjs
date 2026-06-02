import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(root, "..", "js", "firebase-config.js");
const examplePath = path.join(root, "..", "js", "firebase-config.example.js");

const config = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  databaseURL: process.env.FIREBASE_DATABASE_URL || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.FIREBASE_APP_ID || "",
};

const hasEnv = config.apiKey && config.projectId;

if (hasEnv) {
  const body = `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;
  fs.writeFileSync(outPath, body, "utf8");
  console.log("firebase-config.js generat din variabilele Vercel.");
} else if (!fs.existsSync(outPath)) {
  fs.copyFileSync(examplePath, outPath);
  console.log("firebase-config.js copiat din exemplu (completeaza manual sau seteaza env pe Vercel).");
} else {
  console.log("firebase-config.js existent — pastrat.");
}
