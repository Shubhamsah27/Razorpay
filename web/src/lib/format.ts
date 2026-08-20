export function rupees(paise: number, decimals = 0): string {
  const sign = paise < 0 ? "-" : "";
  return `${sign}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Indian short scale, which is how these numbers are actually read aloud. */
export function rupeesShort(paise: number): string {
  const rupeeValue = Math.abs(paise) / 100;
  const sign = paise < 0 ? "-" : "";
  if (rupeeValue >= 1_00_00_000) return `${sign}₹${(rupeeValue / 1_00_00_000).toFixed(2)}Cr`;
  if (rupeeValue >= 1_00_000) return `${sign}₹${(rupeeValue / 1_00_000).toFixed(2)}L`;
  if (rupeeValue >= 1_000) return `${sign}₹${(rupeeValue / 1_000).toFixed(1)}K`;
  return `${sign}₹${rupeeValue.toFixed(0)}`;
}

export function percent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function titleise(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function hourLabel(hour: number): string {
  if (hour < 24) return `+${hour.toFixed(0)}h`;
  return `+${Math.floor(hour / 24)}d ${Math.round(hour % 24)}h`;
}

const STATE_TONE: Record<string, "green" | "red" | "amber" | "neutral"> = {
  succeeded: "green",
  failed: "red",
  blocked: "red",
  rejected: "red",
  outcome_unknown: "amber",
  reconciling: "amber",
  awaiting_approval: "amber",
  executing: "neutral",
  ready: "neutral",
  planned: "neutral",
};

export function stateTone(state: string): "green" | "red" | "amber" | "neutral" {
  return STATE_TONE[state] ?? "neutral";
}

export const STATE_COLOR: Record<string, string> = {
  succeeded: "#2fd48a",
  failed: "#ff6b72",
  blocked: "#ff6b72",
  rejected: "#ff6b72",
  outcome_unknown: "#f0b849",
  reconciling: "#f0b849",
  awaiting_approval: "#f0b849",
  executing: "#4d7fff",
  ready: "#5d6d86",
  planned: "#40566d",
};
