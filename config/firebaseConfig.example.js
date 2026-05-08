// Public browser Firebase config for the Just Dee Dee Music Map prototype.
// This file is safe to serve from GitHub Pages. Never put service-account
// private keys, admin credentials, or backend secrets in browser config.
window.JDDM_FIREBASE_CONFIG = {
    apiKey: "AIzaSyB-1Q_QQ2HataLA6usf9H8WAQP0rAhILr0",
    authDomain: "just-dee-dee-music-map.firebaseapp.com",
    projectId: "just-dee-dee-music-map",
    storageBucket: "just-dee-dee-music-map.firebasestorage.app",
    messagingSenderId: "460609469410",
    appId: "1:460609469410:web:6c53d1c196f1ceeaf197bb",
    measurementId: "G-KHN5ZF1G54"
};

// Google Apps Script bridge for editing spreadsheet rows from marker cards.
// Clean storage bridge: one Status column controls row colors and map played state.
window.JDDM_SPREADSHEET_API_URL = "https://script.google.com/macros/s/AKfycbyOems33yVzMEq_ucgoajSg3cYCq-68sM1ngKP2d0pdvA3OpJCG34ZAAM-cIeQouDKu/exec";
window.JDDM_VENUE_CSV_URL = `${window.JDDM_SPREADSHEET_API_URL}?action=csv&autofill=0`;
// window.JDDM_SPREADSHEET_EDIT_TOKEN = "";
