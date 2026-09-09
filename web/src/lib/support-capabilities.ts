const SUPPORT_CAP:Record<string,[string,string,string]>={
  "support.ticket_create":["Create tickets for customers","Can open a support ticket from the Admin Center on behalf of a customer.","Support"],
  "support.escalate":["Escalate tickets","Can escalate a ticket to the next support hierarchy level with a required reason.","Support"],
  "support.escalation.manage":["Manage escalations","Can de-escalate or supervise escalated tickets within their authority level.","Support"],
  "support.departments.manage":["Manage support departments","Can create/edit departments and assign support staff to departments.","Support"],
  "support.kb.view":["View Knowledge Base","Can view draft, internal and published Knowledge Base content in Admin.","Support"],
  "support.kb.manage":["Manage Knowledge Base","Can create, edit, publish, archive and organise Knowledge Base articles.","Support"]
};
export {SUPPORT_CAP};
