import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLnwlg14ONZi4SHpx3ZIWiHk4XNIIcZX8",
    authDomain: "pollaromeros.firebaseapp.com",
    projectId: "pollaromeros",
    storageBucket: "pollaromeros.firebasestorage.app",
    messagingSenderId: "1085011471930",
    appId: "1:1085011471930:web:310ed17277b04d62ab0f03"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
