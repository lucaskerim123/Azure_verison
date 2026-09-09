# OrbitFS Admin V3 UI notes

## September 2026 readability update

- System Settings uses neutral light surfaces instead of dark navy-on-navy cards.
- V3 primary accent is muted green/graphite instead of the previous strong blue treatment.
- Mobile primary navigation, context navigation, settings controls and save actions use larger touch targets.
- Settings data behaviour is unchanged: the existing permission checks and `app_settings` Supabase update flow remain authoritative.
- Public homepage catalogue and public configuration are rendered from Supabase at request time so active products and saved public settings are included in the response.
