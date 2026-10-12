export interface KoiTexture { scheme: unknown; tex: HTMLCanvasElement }
export function makeKoiTexturesAsync(step: (done: number) => Promise<unknown>): Promise<KoiTexture[]>;
export function createKoiSchool(textures?: KoiTexture[]): {
  setSize(w: number, h: number): void;
  advance(tnow: number): void;
  frame(ctx: CanvasRenderingContext2D, tnow: number): void;
};
