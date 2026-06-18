export class Playback {
  private _head = 0;
  constructor(
    public readonly pullCount: number,
    public readonly pullsPerSecond: number,
  ) {}

  get head(): number { return this._head; }
  get done(): boolean { return this._head >= this.pullCount; }

  advance(dtMs: number): void {
    this._head = Math.min(this.pullCount, this._head + (this.pullsPerSecond * dtMs) / 1000);
  }

  seekFraction(f: number): void {
    this._head = Math.max(0, Math.min(1, f)) * this.pullCount;
  }

  reset(): void { this._head = 0; }

  private durationSec(): number { return this.pullCount / this.pullsPerSecond; }

  totalFrames(fps: number): number { return Math.round(this.durationSec() * fps); }

  headForFrame(frame: number, fps: number): number {
    const frac = frame / this.totalFrames(fps);
    return Math.max(0, Math.min(1, frac)) * this.pullCount;
  }
}
