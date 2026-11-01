// Public browser configuration. Never put a database password, secret key or service_role key here.
window.PODHOD_CONFIG = {
  backend: 'supabase', // 'local' retains the older Python/SQLite mode.
  supabaseUrl: 'https://llddamrspbpcddykrlss.supabase.co', // e.g. https://your-project.supabase.co
  supabasePublishableKey: '', // sb_publishable_... or the legacy anon public key
  emailRecoveryEnabled: false // Enable after setting up a working SMTP sender in Supabase.
};
