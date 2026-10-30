import { redirect } from "next/navigation";

export default function TransfersIndexPage() {
  redirect("/transfers/inbound");
}
