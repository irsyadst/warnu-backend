const admin = require('firebase-admin');

// Inisialisasi Firebase Admin
// serviceAccountKey.json akan otomatis terdeteksi jika variabel env GOOGLE_APPLICATION_CREDENTIALS di-set
// atau jika file ada di root saat development.
admin.initializeApp();

const db = admin.firestore();

module.exports = { admin, db };