// a fish of the school, in the school's pixel space; the trail runs from the
// head backwards
export interface KoiFish {
  x: number; y: number; heading: number; len: number;
  trail: { x: number; y: number }[];
  tailPhase: number; texPhase: number; uvOff: number;
  tex: HTMLCanvasElement;
  scheme: { base: number[]; mid: number[]; hot: number[] };
}
export interface KoiTexture { scheme: unknown; tex: HTMLCanvasElement }
export function makeKoiTexturesAsync(step: (done: number) => Promise<unknown>): Promise<KoiTexture[]>;
export function createKoiSchool(textures?: KoiTexture[]): {
  setSize(w: number, h: number): void;
  advance(tnow: number): void;
  fish(): KoiFish[];
  frame(ctx: CanvasRenderingContext2D, tnow: number): void;
};
