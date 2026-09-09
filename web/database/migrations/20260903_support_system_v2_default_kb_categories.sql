-- Seed structure for the Support Knowledge Base without inventing fake support articles.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
insert into public.support_kb_categories(name,slug,description,enabled,sort_order)
values
 ('Getting Started','getting-started','Setup, onboarding and first-use guidance.',true,10),
 ('Accounts & Billing','accounts-billing','Accounts, invoices, Wallet, payments, cancellations and refunds.',true,20),
 ('Licensing & Activation','licensing-activation','Licence activation, devices, entitlement and access guidance.',true,30),
 ('Products & Configuration','products-configuration','Product setup and configurable service options.',true,40),
 ('Troubleshooting','troubleshooting','Known issues, diagnostics and common fixes.',true,50)
on conflict(slug) do nothing;
