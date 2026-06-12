import { ManageView } from "@/components/manage-view";

export const dynamic = "force-dynamic"; // re-read the (possibly re-simulated) artifact each load

export default function ManagePage() {
  return <ManageView />;
}
