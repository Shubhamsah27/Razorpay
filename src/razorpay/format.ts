/** Rupee label for CLI output. Kept separate so entry points stay thin. */
export function rupeesLabel(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
