import { STATE_MEANING, STATE_ORDER, firedReport } from "../../fired.js";
export function firedPanel(src, today) {
  return {
    ...firedReport(src.store, today),
    vocabulary: STATE_ORDER.map((state) => ({ state, meaning: STATE_MEANING[state] })),
    zone: src.store.zone()
  };
}
