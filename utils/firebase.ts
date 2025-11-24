import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Safe access to environment variables
const getEnv = (key: string, fallback: string) => {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
  } catch (e) {
    // Ignore error if process is not defined
  }
  return fallback;
};

// Configuration using environment variables with fallbacks to provided keys
const firebaseConfig = {
  apiKey: getEnv("FIREBASE_API_KEY", "AIzaSyCcCYkiiagIPtII8WoLlRHlIFt-yGCVKYs"),
  authDomain: getEnv("FIREBASE_AUTH_DOMAIN", "ezgemini-live.firebaseapp.com"),
  projectId: getEnv("FIREBASE_PROJECT_ID", "ezgemini-live"),
  storageBucket: getEnv("FIREBASE_STORAGE_BUCKET", "ezgemini-live.firebasestorage.app"),
  messagingSenderId: getEnv("FIREBASE_MESSAGING_SENDER_ID", "604584885430"),
  appId: getEnv("FIREBASE_APP_ID", "1:604584885430:web:3fb5a1ff8cff2a4c777a17"),
  measurementId: "G-1V4WJVZK67"
};

let app;
let auth;

try {
  // Initialize Firebase with the config
  app = initializeApp(firebaseConfig);
  // Initialize Auth
  auth = getAuth(app);
} catch (error) {
  console.error("Firebase initialization error:", error);
  // Reset auth if initialization failed
  auth = undefined;
}

export { auth };