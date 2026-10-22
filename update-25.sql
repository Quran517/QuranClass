-- =====================================================================
-- Update 25: new name "SLIS-Jeddah Quran Thajweed Class"
--   (only changes the name if it is still the old one — a name you typed
--    yourself in Settings is kept)
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================

alter table public.settings alter column school_name set default 'SLIS-Jeddah Quran Thajweed Class';
alter table public.settings alter column card_note set default 'If found, please return to SLIS-Jeddah Quran Thajweed Class.';

update public.settings set school_name = 'SLIS-Jeddah Quran Thajweed Class'
 where school_name in ('SLIS-Jeddah Quran Class', 'SLIS Jeddah Quran Class');
update public.settings set card_note = 'If found, please return to SLIS-Jeddah Quran Thajweed Class.'
 where card_note is null or card_note = 'If found, please return to SLIS-Jeddah Quran Class.';
update public.settings set school_name_ar = 'حلقة القرآن الكريم والتجويد'
 where coalesce(school_name_ar, '') = '';

select 'Update 25 installed — name: ' || school_name as result from public.settings limit 1;
