import Intro from "@/components/home/Intro";
import { weeklyJackpotKnives } from "@/lib/intro-jackpots";

// The front door: an intro that plays on its own. The Lounge, a flight down
// through the waterfall into the cave behind it, and a close-up of this
// week's three biggest knife jackpots standing in the rock. The 3D is drawn
// by the Lounge backdrop in the root layout; this page hands it the knives
// and lays the captions over the close-up.
export default function Home() {
  const { knives, generatedAt } = weeklyJackpotKnives(3);
  return <Intro knives={knives} generatedAt={generatedAt} />;
}
