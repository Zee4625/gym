/* Public configuration only. NEVER put a secret key here (no sb_secret_..., no service_role).
   The Supabase publishable key and the Firebase apiKey are PUBLIC by design: what protects the data is Row Level Security / Firestore rules.
   When the site is served by server/server.js this file is replaced by the server. */
window.FORMA_CFG={
  server:false,
  turnstile:"",
  supabase:{url:"https://ewlomjcwnrxydlkgzdqw.supabase.co",key:"sb_publishable_6yvOvJZUMmZY_tnaEM9FgA_oe0XvACa"},
  firebase:{apiKey:"",projectId:""}
};
