import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://avvceclgilevnemgbmch.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2dmNlY2xnaWxldm5lbWdibWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTEzNjgsImV4cCI6MjA5NDk2NzM2OH0.aKSr8CQY-2tDqXCAeOheV3jtlC83r4guiKM88s8iS8s'

export const supabase = createClient(supabaseUrl, supabaseKey)

