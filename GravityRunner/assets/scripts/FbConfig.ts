// Firebase web-app config.
//
// HOW TO FILL THIS IN (1 minute):
//   1. https://console.firebase.google.com -> project (e.g. mario-1145141919810)
//   2. Project settings (gear) -> Your apps -> Web app -> SDK setup -> Config
//   3. Paste the values below. Leaving apiKey empty disables all online
//      features gracefully (game falls back to localStorage).
//
// Also required in the console once:
//   - Authentication -> Sign-in method -> enable Email/Password
//   - Realtime Database -> Create database -> rules (course demo):
//       {
//         "rules": {
//           "saves":       { "$uid": { ".read": "$uid === auth.uid", ".write": "$uid === auth.uid" } },
//           "leaderboard": { ".read": true, "$uid": { ".write": "$uid === auth.uid" } }
//         }
//       }
const FB_CONFIG: any = {
    apiKey: "",
    authDomain: "mario-1145141919810.firebaseapp.com",
    databaseURL: "https://mario-1145141919810-default-rtdb.firebaseio.com",
    projectId: "mario-1145141919810"
};

export default FB_CONFIG;
