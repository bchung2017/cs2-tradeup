export function createKoiSchool(): {
  setSize(w: number, h: number): void;
  advance(tnow: number): void;
  frame(ctx: CanvasRenderingContext2D, tnow: number): void;
};
