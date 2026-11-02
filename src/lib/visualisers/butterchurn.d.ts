declare module "butterchurn" {
  interface ButterchurnVisualizer {
    setRendererSize(width: number, height: number): void;
    loadPreset(preset: object, blendTimeSeconds: number): void;
    launchSongTitleAnim(text: string): void;
    render(options?: {
      audioLevels?: { timeByteArray: Uint8Array; timeByteArrayL: Uint8Array; timeByteArrayR: Uint8Array };
      elapsedTime?: number;
    }): void;
    loseGLContext(): void;
  }
  export default class Butterchurn {
    static createVisualizer(
      audioContext: BaseAudioContext,
      canvas: HTMLCanvasElement,
      options: { width: number; height: number; pixelRatio?: number },
    ): ButterchurnVisualizer;
  }
}

declare module "butterchurn-presets" {
  const presets: Record<string, object>;
  export default presets;
}
