-- Canonical customer-facing OrbitFS Store origin.
-- External/customer links should resolve through this value rather than a deployment hostname inferred from a request.

insert into public.app_settings(key,value,category,public_read,updated_at)
values('site.public_url',to_jsonb('https://orbitfsstore.vercel.app'::text),'customization',true,now())
on conflict(key) do update
set value=excluded.value,category=excluded.category,public_read=true,updated_at=now();

-- Guest-support confirmation mail links directly back to the temporary-ticket entry point.
update public.mail_templates
set subject='OrbitFS guest support ticket #{{ticket_number}}',
    html=$html$<p>Hello {{customer_name}},</p><p>We received your support request <strong>#{{ticket_number}}</strong>: {{ticket_subject}}</p><p>Your private guest ticket code is:</p><p style="font-size:20px;font-weight:700;letter-spacing:1px">{{guest_code}}</p><p><a href="{{support_url}}">Open OrbitFS Support</a> and enter this code to read replies and continue the conversation without an account.</p><p>This guest ticket expires and is automatically deleted at <strong>{{expires_at}}</strong>.</p><p>Guest support is limited to General Support and Sales.</p>$html$,
    text_body=$text$Hello {{customer_name}},

We received your support request #{{ticket_number}}: {{ticket_subject}}.

Your private guest ticket code is: {{guest_code}}

Open OrbitFS Support: {{support_url}}
Enter the code there to read replies and continue the conversation without an account.

This guest ticket expires and is automatically deleted at {{expires_at}}.

Guest support is limited to General Support and Sales.$text$,
    updated_at=now()
where template_key='support_guest_created';

update public.mail_automations
set variables='["customer_name","ticket_number","ticket_subject","guest_email","guest_code","expires_at","support_url"]'::jsonb,
    description='Confirm a temporary guest support request and provide its private 48-hour access code and Store support link',
    updated_at=now()
where event_key='support.guest.created';

-- Record which gateway webhook registrations still point at a previous Store hostname.
-- Do not overwrite registered_url here: that field must continue to describe the provider-side endpoint until reconfiguration succeeds.
update public.payment_gateway_setups s
set metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object(
      'canonical_store_origin','https://orbitfsstore.vercel.app',
      'webhook_reconfigure_required',
      case
        when g.code in ('stripe','paypal') then coalesce(s.webhook_config->>'registered_url','') <> 'https://orbitfsstore.vercel.app/api/payments/webhook/'||g.code
        else false
      end
    ),
    updated_at=now()
from public.payment_gateways g
where g.id=s.gateway_id;
