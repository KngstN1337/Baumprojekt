// Wird beim Veröffentlichen einmal ausgefüllt (siehe ANLEITUNG.md).
// Die Client-ID ist öffentlich und gibt dem Herausgeber KEINEN Zugriff auf die Daten der Nutzer.
window.BAUMPROJEKT_CONFIG = {
  version: '75',
  googleClientId: '861233150929-foqaha1ki1gfir0o80quuvqq70k4fbh3.apps.googleusercontent.com',
  sttModel: 'gpt-transcribe',
  llmModel: 'gpt-4.1-mini',
  // true = Google-Anmeldung ohne Popup/neuen Tab (Weiterleitungs-URI muss in der Google Cloud Console eingetragen sein)
  loginRedirect: true,
  redirectUri: 'https://kngstn1337.github.io/Baumprojekt/',
  // API-Schlüssel für die Google-Auswahl (Picker) beim Hinzufügen geteilter Lehrgänge. Öffentlich, gibt keinen Datenzugriff.
  googleApiKey: 'AIzaSyA2aOP1cLKA42Rvdi9leKiEfXvZaXmuMZI'
};
