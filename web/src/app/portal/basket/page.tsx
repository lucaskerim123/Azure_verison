import { redirect } from "next/navigation";

export default function Basket() {
  redirect("/portal/products#store-checkout");
}
