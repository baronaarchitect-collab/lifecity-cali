/* ============================================================
   LifeCity · Configuración de Firebase (Auth + Firestore)
   ------------------------------------------------------------
   Proyecto: lifecity-cali-app  ·  consola:
   https://console.firebase.google.com/project/lifecity-cali-app
   Estas claves son públicas por diseño (viajan al navegador).
   Lo que protege los datos de cada usuario son firestore.rules.
   Si se deja vacío, el login funciona en MODO LOCAL (demo).
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDzT_iKY5QSCzaQLvYQxoXZZKXaW-k0B5E',
  authDomain: 'lifecity-cali-app.firebaseapp.com',
  projectId: 'lifecity-cali-app',
  storageBucket: 'lifecity-cali-app.firebasestorage.app',
  messagingSenderId: '479697017875',
  appId: '1:479697017875:web:e5c18479c808b06ae133e6'
};
window.FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
