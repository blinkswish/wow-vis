/** Standard WoW class colors, keyed by the class name WCL returns in `type`
 * (no spaces, e.g. "DeathKnight"). */
export const CLASS_COLORS: Record<string, string> = {
  DeathKnight: "#C41E3A",
  DemonHunter: "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

/** Class color for a player's class, or a neutral fallback. */
export function classColor(cls: string | undefined, fallback: string): string {
  return (cls && CLASS_COLORS[cls]) || fallback;
}
