export class StoreError extends Error {
  code;
  detail;
  constructor(code, detail = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "StoreError";
    this.code = code;
    this.detail = detail;
  }
}
export function isStoreError(e, code) {
  return e instanceof StoreError && (code === undefined || e.code === code);
}
