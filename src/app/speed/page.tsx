import { redirect } from "next/navigation";

/** Flip Speed is now the "Speed" view of the Flip Scanner. */
export default function SpeedPage() {
  redirect("/scanner?view=speed");
}
