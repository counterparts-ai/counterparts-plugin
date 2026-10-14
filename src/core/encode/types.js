export const SELF_SUBJECT = "self";
export const GATES = ["secrets", "precision", "aliases", "emotion", "floor"];
export const CHANNELS = ["emotion-classifier", "semantic-preselection"];

export class EncodeError extends Error {
  code;
  detail;
  constructor(code, detail = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "EncodeError";
    this.code = code;
    this.detail = detail;
  }
}
