// Vercel build script — injects environment variables into env.js
// Runs automatically before deploy (configured in vercel.json)

import { writeFileSync } from 'fs';

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL      || 'https://aagwxidfryadegauazab.supabase.co';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhZ3d4aWRmcnlhZGVnYXVhemFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzQxODAsImV4cCI6MjA5MTM1MDE4MH0.cXcjezxO87B7Tu-TKTCFETyn0Ab0HUJqZw9qX4V082A';

const envJs = `window.SUPABASE_URL      = '${url}';\nwindow.SUPABASE_ANON_KEY = '${anonKey}';\n`;
writeFileSync('public/js/env.js', envJs);

console.log('✅ env.js generated');
console.log('   SUPABASE_URL:', url ? url.substring(0, 30) + '...' : '(not set)');
console.log('   ANON_KEY:    ', anonKey ? anonKey.substring(0, 20) + '...' : '(not set)');
// force redeploy Fri Apr 10 18:47:59     2026
