const SHEET_INTERACTION_LAYER_SELECTOR = '[data-sheet-interaction-layer]';

type ClosestTarget = {
  closest?: (selector: string) => unknown;
};

export const isSheetInteractionLayerTarget = (target: EventTarget | null): boolean => {
  const closest = (target as ClosestTarget | null)?.closest;
  if (typeof closest !== 'function') return false;
  return Boolean(closest.call(target, SHEET_INTERACTION_LAYER_SELECTOR));
};
