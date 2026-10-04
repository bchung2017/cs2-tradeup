import MyVentures from "@/components/venture/MyVentures";
import { loadVentures } from "@/lib/ventures-data";

export default function MyVenturesPage() {
  return <MyVentures market={loadVentures()} />;
}
