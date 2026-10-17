"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { IntroKnife } from "@/components/circuit/loungeCave";
import { offerIntro, withdrawIntro } from "@/lib/intro-bus";

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const odds = (p: number) => (p > 0 ? `1 in ${Math.round(1 / p).toLocaleString("en-US")}` : "");

// Captions for the intro's close-up, laid out as the knives stand: #2 left,
// #1 centre, #3 right. If the 3D can't run, they show straight away with the
// knives' pictures instead.
export default function Intro({ knives, generatedAt }: { knives: IntroKnife[]; generatedAt: string }) {
  const [stage, setStage] = useState("");
  useEffect(() => {
    offerIntro(knives);
    const on = (e: Event) => setStage((e as CustomEvent<string>).detail);
    addEventListener("lounge:intro", on);
    return () => { withdrawIntro(); removeEventListener("lounge:intro", on); };
  }, [knives]);

  const shown = stage === "closeup" || stage === "failed";
  const order = [1, 0, 2].filter((i) => knives[i]);
  const week = generatedAt ? new Date(generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  return (
    <main className={`intro${shown ? " is-shown" : ""}`} aria-live="polite">
      {stage !== "closeup" && stage !== "failed" && (
        <Link href="/venture/market" className="intro-skip">skip intro →</Link>
      )}
      <section className="intro-caption" aria-hidden={!shown}>
        <h1 className="hud">JACKPOTS OF THE WEEK{week ? <span> · ventures of {week}</span> : null}</h1>
        <ol className="intro-knives">
          {order.map((i) => {
            const k = knives[i];
            return (
              <li key={k.name + k.phase} className={i === 0 ? "is-first" : ""}>
                {stage === "failed" && <img src={k.image} alt="" />}
                <span className="intro-rank">#{i + 1}</span>
                <span className="intro-name">{k.name.replace(/^★\s*/, "")}{k.phase ? ` (${k.phase})` : ""}</span>
                <span className="intro-meta">{k.wear} · {usd(k.value)} · {odds(k.probability)} per contract</span>
              </li>
            );
          })}
        </ol>
        <Link href="/venture/market" className="intro-enter">Enter the market →</Link>
      </section>
    </main>
  );
}
