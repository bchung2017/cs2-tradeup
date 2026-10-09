"use client";

// Venture → Simulator, two ways. "Open the stack" stages the contract as
// specified: every input at its float cap. "Pre-fill with what you have" puts
// your fitting copies in their slots and leaves the rest to buy. The simulator takes
// it from there and recomputes on every edit.
import { useRouter } from "next/navigation";
import { useTradeup, type Slot } from "@/lib/tradeup-context";
import type { Plan } from "@/lib/venture-fit";
import { money } from "@/lib/venture-copy";

function toSlots(plan: Plan, withOwned: boolean): Slot[] {
  return plan.slots.map((s) =>
    withOwned && s.owned
      ? { skin: s.owned.skin, float: s.owned.float, stattrak: false, price: s.owned.price, origin: "owned" }
      : { skin: s.skin, float: s.input.floatMax, stattrak: false, price: s.input.priceEach, origin: "buy" },
  );
}

export default function Handoff({ plan }: { plan: Plan | null | undefined }) {
  const { setSlots } = useTradeup();
  const router = useRouter();
  const go = (withOwned: boolean) => {
    if (!plan) return;
    setSlots(toSlots(plan, withOwned));
    router.push("/simulator");
  };
  const mine = plan?.ownedCount ?? 0;
  return (
    <div className="vx-handoff">
      <button className="hud" disabled={!plan} onClick={() => go(false)} title="Every input at its float cap, all to buy">
        Open the stack
      </button>
      <button
        className="hud"
        disabled={!plan || mine === 0}
        onClick={() => go(true)}
        title={mine ? `${mine} slot${mine > 1 ? "s" : ""} from your inventory, rest ${money(plan!.rest)}` : "None of your copies fit the float budget"}
      >
        Pre-fill with what you have{mine > 0 ? ` · ${mine}` : ""}
      </button>
      {!plan && <span className="dim">loading catalog…</span>}
    </div>
  );
}
