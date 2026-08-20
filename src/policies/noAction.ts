import type { Policy } from "../domain/view";

/** Observes the case's organic outcome and nothing else. */
export const noActionPolicy: Policy = {
  name: "no_action",
  next: () => null,
};
