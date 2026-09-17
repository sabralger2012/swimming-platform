import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://csfdmbwwaftyzsxvimvc.supabase.co'

const supabasePublishableKey =
  'sb_publishable_dibwEFdpk2losZrBom1-8Q_CLkV_Cek'

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
)
