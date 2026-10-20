// A saved configuration wins over any older startup request still in flight.
export function createSettingsReceiver(apply) {
  let generation=0;
  return {
    async read(load) {
      const token=++generation;
      const value=await load();
      if(token===generation)apply(value);
    },
    saved(value) {generation++;apply(value);},
    cancel() {generation++;}
  };
}
