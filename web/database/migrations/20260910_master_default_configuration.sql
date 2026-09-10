-- OrbitFS Master default configuration seed
-- Safe to run after the core schema. No customer/staff user memberships or secrets are included.

insert into public.role_definitions(role_key,name,description,rank,permissions,active,sort_order) values
('user','User','Customer account',10,'["account.self","orders.self","licenses.self","support.self"]'::jsonb,true,10),
('support','Support','Support staff',50,'["support.manage","customers.read","orders.read","licenses.read"]'::jsonb,true,20),
('admin','Admin','Platform administrator',80,'["support.manage","customers.manage","orders.manage","licenses.manage","credit.manage","catalog.manage","settings.read"]'::jsonb,true,30),
('superadmin','Superadmin','Full system administrator',100,'["*"]'::jsonb,true,40)
on conflict(role_key) do nothing;

insert into public.role_permissions(role,permissions) values
('user','{"portal":true,"tickets:own":true,"credit:view_own":true,"orders:view_own":true}'::jsonb),
('support','{"portal":true,"mail.view":true,"orders.edit":true,"orders.view":true,"admin.access":true,"invoices.view":true,"licenses.view":true,"support.claim":true,"support.close":true,"support.reply":true,"customers.edit":true,"customers.view":true,"support.manage":true,"support.archive":true,"support.priority":true,"support.transfer":true,"support.department":true,"support.premade.use":true,"support.ticket_create":true,"customers.password_reset":true}'::jsonb),
('admin','{"portal":true,"mail.view":true,"mail.admin":true,"staff.view":true,"orders.edit":true,"orders.view":true,"admin.access":true,"staff.invite":true,"staff.manage":true,"credit.manage":true,"invoices.edit":true,"invoices.view":true,"licenses.edit":true,"licenses.view":true,"mail.settings":true,"support.claim":true,"support.close":true,"support.reply":true,"analytics.view":true,"coupons.manage":true,"customers.edit":true,"customers.view":true,"mail.templates":true,"orders.approve":true,"orders.suspend":true,"support.assign":true,"support.manage":true,"orders.activate":true,"payments.manage":true,"products.manage":true,"support.archive":true,"licenses.enforce":true,"orders.terminate":true,"settings.billing":true,"settings.general":true,"support.escalate":true,"support.priority":true,"support.settings":true,"support.transfer":true,"customers.enforce":true,"orders.edit_items":true,"settings.identity":true,"staff.groups.view":true,"support.kb.manage":true,"license_api.manage":true,"notifications.send":true,"support.department":true,"staff.groups.manage":true,"support.premade.use":true,"support.ticket_edit":true,"billing.change_state":true,"support.premade.manage":true,"customers.cancellations":true,"invoices.record_payment":true,"orders.attach_license":true,"billing.override_state":true,"payment_gateways.manage":true,"customers.password_reset":true,"support.escalation.manage":true,"support.departments.manage":true}'::jsonb),
('superadmin','{"all":true}'::jsonb)
on conflict(role) do nothing;

insert into public.staff_groups(slug,name,description,permissions,is_system,sort_order) values
('superadmin','Superadmin','System owner authority. Final support escalation level with unrestricted OrbitFS access.','{"all":true,"mail.send":true,"mail.view":true,"mail.admin":true,"staff.view":true,"admin.access":true,"staff.invite":true,"staff.manage":true,"mail.settings":true,"mail.templates":true,"mail.queue.view":true,"mail.queue.manage":true,"staff.groups.view":true,"notifications.send":true,"staff.groups.manage":true,"settings.permissions":true,"mail.account.admin.send":true,"mail.account.admin.view":true,"mail.account.billing.send":true,"mail.account.billing.view":true,"mail.account.support.send":true,"mail.account.support.view":true}'::jsonb,true,1),
('admin','Administrator','Administrative manager. Manages departments, settings, escalated support and broader OrbitFS operations.','{"admin.access":true,"staff.view":true,"staff.invite":true,"staff.manage":true,"staff.groups.view":true,"staff.groups.manage":true,"support.manage":true,"support.department":true,"support.departments.manage":true,"support.escalation.manage":true,"settings.general":true,"settings.billing":true,"settings.identity":true,"license_api.manage":true,"customers.view":true,"customers.edit":true,"orders.view":true,"orders.edit":true,"licenses.view":true,"licenses.edit":true,"invoices.view":true,"invoices.edit":true,"products.manage":true,"payments.manage":true,"credit.manage":true,"coupons.manage":true,"notifications.send":true,"mail.view":true,"mail.admin":true,"mail.settings":true,"mail.templates":true}'::jsonb,true,10),
('senior-support','Senior Support','Support supervisor. Oversees workers, assignments, escalations, routing and support knowledge.','{"portal":true,"admin.access":true,"staff.view":true,"support.manage":true,"support.claim":true,"support.assign":true,"support.close":true,"support.reply":true,"support.escalate":true,"support.transfer":true,"support.priority":true,"support.department":true,"support.departments.manage":true,"support.escalation.manage":true,"support.kb.view":true,"support.kb.manage":true,"customers.view":true,"customers.edit":true,"orders.view":true,"orders.edit":true,"licenses.view":true,"licenses.edit":true,"invoices.view":true,"invoices.edit":true,"credit.manage":true,"coupons.manage":true,"notifications.send":true,"customers.password_reset":true,"mail.view":true,"mail.send":true}'::jsonb,true,15),
('support','Support','Front-line support worker. Handles assigned department queues, customer replies, ticket triage and escalation.','{"portal":true,"admin.access":true,"staff.view":true,"orders.view":true,"invoices.view":true,"licenses.view":true,"customers.view":true,"support.manage":true,"support.claim":true,"support.close":true,"support.reply":true,"support.escalate":true,"support.priority":true,"support.transfer":true,"support.department":true,"support.kb.view":true,"support.premade.use":true,"support.ticket_create":true,"support.archive":true,"customers.password_reset":true,"mail.account.support.send":true,"mail.account.support.view":true}'::jsonb,true,20)
on conflict(slug) do nothing;

insert into public.support_departments(name,slug,description,email,enabled,client_can_close,sort_order,allow_direct_create,min_support_rank) values
('General Support','general-support','General customer support and account help.','support@orbitfs.cc',true,true,10,true,1),
('Advanced General Support','advanced-general-support','Advanced general support queue for Tier 2 and higher.','support@orbitfs.cc',true,true,20,false,2),
('Sales Enquiries','sales-enquiries','Pre-sales, product and purchasing enquiries.','billing@orbitfs.cc',true,true,30,true,1),
('Billing Enquiries','billing-enquiries','Invoices, payments, wallet credit and billing enquiries.','billing@orbitfs.cc',true,true,40,true,1),
('Technical Support','technical-support','Technical product, service and configuration support.','admin@orbitfs.cc',true,true,50,true,1),
('Advanced Technical Support','advanced-technical-support','Advanced technical support queue for Tier 2 and higher.','admin@orbitfs.cc',true,true,60,false,2)
on conflict(slug) do nothing;

update public.support_departments d set escalation_department_id=e.id from public.support_departments e where d.slug='general-support' and e.slug='advanced-general-support';
update public.support_departments d set escalation_department_id=e.id from public.support_departments e where d.slug='technical-support' and e.slug='advanced-technical-support';

insert into public.option_sets(set_key,option_key,label,value,active,sort_order) values
('account_status','active','Active','"active"'::jsonb,true,10),('account_status','suspended','Suspended','"suspended"'::jsonb,true,20),('account_status','closed','Closed','"closed"'::jsonb,true,30),
('order_status','pending','Pending','"pending"'::jsonb,true,10),('order_status','processing','Processing','"processing"'::jsonb,true,20),('order_status','completed','Completed','"completed"'::jsonb,true,30),('order_status','cancelled','Cancelled','"cancelled"'::jsonb,true,40),
('ticket_priority','low','Low','"low"'::jsonb,true,10),('ticket_priority','normal','Normal','"normal"'::jsonb,true,20),('ticket_priority','high','High','"high"'::jsonb,true,30),('ticket_priority','urgent','Urgent','"urgent"'::jsonb,true,40)
on conflict(set_key,option_key) do nothing;

insert into public.enforcement_settings(id,integration_enabled,auto_suspend_overdue,overdue_grace_days,auto_restore_paid,ban_blocks_licenses,suspension_blocks_licenses) values(true,false,true,0,true,true,true)
on conflict(id) do nothing;
insert into public.license_api_settings(api_name,base_url,mode,enabled,validation_path,registration_path,activation_path,revision_path,health_path,issuer,audience,entitlement_ttl_seconds,grace_seconds,max_failed_validations,allow_offline_grace)
values('OrbitFS Licence API','/api/license/v1','active',true,'/api/license/v1/validate','/api/license/v1/register','/api/license/v1/activate','/api/license/v1/revision','/api/license/v1/health','orbitfs-website','orbitfs-runtime',1800,0,10,false);

insert into public.mail_accounts(address,display_name,kind,active) values
('admin@orbitfs.cc','OrbitFS Admin','shared',true),('billing@orbitfs.cc','OrbitFS Billing','shared',true),('noreply@orbitfs.cc','OrbitFS','shared',true),('support@orbitfs.cc','OrbitFS Support','shared',true)
on conflict(address) do nothing;

insert into public.mail_settings(key,value) values
('provider','{"name":"resend"}'::jsonb),
('inbound','{"domain":"orbitfs.cc","enabled":true}'::jsonb),
('outbound','{"reply_to":"admin@orbitfs.cc","sender_name":"OrbitFS","default_from":"noreply@orbitfs.cc","customer_sender":"support@orbitfs.cc","customer_sender_name":"OrbitFS Support"}'::jsonb)
on conflict(key) do nothing;

insert into public.payment_gateways(code,provider,display_name,description,enabled,sort_order,supports_recurring,supports_refunds,supports_partial,currencies,fee_fixed_cents,fee_percent,public_config,secret_env_keys,instructions) values
('account_credit','account_credit','OrbitFS Wallet','Pay instantly using your available OrbitFS Wallet balance',true,10,false,true,true,array['AUD'],0,0,'{}'::jsonb,'{}'::jsonb,'Uses the customer account balance and activates the order immediately after successful payment.'),
('stripe','stripe','Card payment','Card payment through Stripe Checkout.',true,20,true,true,true,array['AUD'],50,0,'{"mode":"checkout"}'::jsonb,'{"secret_key":"STRIPE_SECRET_KEY","webhook_secret":"STRIPE_WEBHOOK_SECRET"}'::jsonb,'Requires Stripe environment credentials before enabling.'),
('paypal','paypal','PayPal','Pay with PayPal.',true,30,true,true,true,array['AUD'],50,0,'{}'::jsonb,'{"client_id":"PAYPAL_CLIENT_ID","webhook_id":"PAYPAL_WEBHOOK_ID","client_secret":"PAYPAL_CLIENT_SECRET"}'::jsonb,'Requires PayPal API credentials and webhook configuration before enabling.'),
('manual_bank','manual','Bank transfer','Manual bank transfer.',false,50,false,true,false,array['AUD'],0,0,'{}'::jsonb,'{}'::jsonb,'Configure bank/payment instructions before enabling.')
on conflict(code) do nothing;

insert into public.orbitfs_themes(id,name,surface,version,description,manifest,is_builtin) values
('V3A','V3A','admin','1.0.0','OrbitFS compact dark admin theme with graphite surfaces, indigo actions and semantic billing/status colours.','{"id":"V3A","entry":"theme.css","family":"V3","surface":"admin"}'::jsonb,true),
('V3C','V3C','customer','1.0.0','OrbitFS compact dark customer portal theme derived from V3A with customer-focused navigation and billing/service displays.','{"id":"V3C","entry":"theme.css","family":"V3","surface":"customer"}'::jsonb,true)
on conflict(id) do update set name=excluded.name,surface=excluded.surface,version=excluded.version,description=excluded.description,manifest=excluded.manifest,is_builtin=true,updated_at=now();

-- Intentionally excluded from defaults: staff_members, staff_member_groups, customers, credentials, sessions, audit history and all secrets/tokens.
