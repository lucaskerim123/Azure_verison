import {redirect} from "next/navigation";
export default async function LegacyMailbox({params}:{params:Promise<{account:string}>}){const {account}=await params;redirect(`/mail/mailbox/${encodeURIComponent(account)}`)}
