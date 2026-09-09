import { redirect } from "next/navigation";

export default function Checkout() {
  redirect("/portal/products#store-checkout");
}
