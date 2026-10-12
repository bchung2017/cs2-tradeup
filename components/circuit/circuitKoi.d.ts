export function initCircuitKoi(canvas: HTMLCanvasElement): {
  setLive(intensity: number, surge: boolean): void;
  setPaused(on: boolean): void;
  destroy(): void;
};
