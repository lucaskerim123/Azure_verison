-- Finalise the requested Support -> Senior Support -> Admin -> Superadmin authority model.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
-- Support is a front-line worker role; Senior Support supervises support operations;
-- Admin manages departments/settings and cross-system administration; Superadmin remains unrestricted.

update public.staff_groups
set permissions = '{
  "portal": true,
  "admin.access": true,
  "mail.view": true,
  "mail.account.support": true,
  "customers.view": true,
  "customers.password_reset": true,
  "orders.view": true,
  "invoices.view": true,
  "licenses.view": true,
  "support.manage": true,
  "support.claim": true,
  "support.transfer": true,
  "support.reply": true,
  "support.priority": true,
  "support.close": true,
  "support.premade.use": true,
  "support.ticket_create": true,
  "support.escalate": true,
  "support.kb.view": true,
  "notes.customer.view": true,
  "notes.order.view": true,
  "notes.invoice.view": true,
  "notes.support.view": true,
  "notes.support.manage": true
}'::jsonb,
    name='Support',
    description='Front-line support worker. Handles assigned department queues, customer replies, ticket triage and escalation.',
    is_system=true,
    sort_order=20,
    updated_at=now()
where slug='support';

update public.staff_groups
set permissions = '{
  "portal": true,
  "admin.access": true,
  "mail.view": true,
  "mail.account.support": true,
  "customers.view": true,
  "customers.password_reset": true,
  "orders.view": true,
  "invoices.view": true,
  "licenses.view": true,
  "support.manage": true,
  "support.claim": true,
  "support.assign": true,
  "support.transfer": true,
  "support.reply": true,
  "support.priority": true,
  "support.department": true,
  "support.close": true,
  "support.archive": true,
  "support.ticket_edit": true,
  "support.premade.use": true,
  "support.premade.manage": true,
  "support.ticket_create": true,
  "support.escalate": true,
  "support.escalation.manage": true,
  "support.kb.view": true,
  "support.kb.manage": true,
  "notes.customer.view": true,
  "notes.order.view": true,
  "notes.invoice.view": true,
  "notes.support.view": true,
  "notes.support.manage": true,
  "notes.external": true
}'::jsonb,
    name='Senior Support',
    description='Support supervisor. Oversees workers, assignments, escalations, routing and support knowledge.',
    is_system=true,
    sort_order=15,
    updated_at=now()
where slug='senior-support';

update public.staff_groups
set description='Administrative manager. Manages departments, settings, escalated support and broader OrbitFS operations.',
    sort_order=10,
    updated_at=now()
where slug='admin';

update public.staff_groups
set description='System owner authority. Final support escalation level with unrestricted OrbitFS access.',
    sort_order=1,
    updated_at=now()
where slug='superadmin';
