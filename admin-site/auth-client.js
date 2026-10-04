// Shared session storage keeps the two auth pages and the workspace in sync.
window.deepTruckAuth = {
  client: window.supabase?.createClient(
    "https://yqpeebgmqtqoxumzfrsq.supabase.co",
    "sb_publishable_GaoXNE-0hGpMDv3cMy3QDA_UfQuvvIM"
  )
};
