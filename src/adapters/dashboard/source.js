export class ObserverRequired extends Error {
  constructor() {
    super("the dashboard reads only in observer mode — open the Counterpart with { observer: true }");
    this.name = "ObserverRequired";
  }
}
export function sourceOf(counterpart) {
  if (!counterpart.observer || !counterpart.store.observer)
    throw new ObserverRequired;
  return {
    store: counterpart.store,
    schemas: counterpart.schemas,
    self: counterpart.self,
    observer: true
  };
}
