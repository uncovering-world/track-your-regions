declare module 'atrament' {
  export default class Atrament {
    constructor(canvas: HTMLCanvasElement, options?: Record<string, unknown>);
    color: string;
    weight: number;
    smoothing: number;
    adaptiveStroke: boolean;
    mode: string;
    destroy(): void;
    clear(): void;
    addEventListener(event: string, handler: (...args: unknown[]) => void): void;
    removeEventListener(event: string, handler: (...args: unknown[]) => void): void;
  }
  export const MODE_DRAW: string;
  export const MODE_ERASE: string;
  export const MODE_FILL: string;
  export const MODE_DISABLED: string;
}
