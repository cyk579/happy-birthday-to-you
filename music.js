/** One decoded, looping score; volume intent survives loading and page visibility changes. */
export class AmbientMusic {
  constructor(context, onState = () => {}) {
    this.context = context;
    this.onState = typeof onState === 'function' ? onState : () => {};
    this.source = null;
    this.gain = null;
    this._desiredLevel = 0;
    this._state = 'idle';
    this._disposed = false;
    this._startPromise = null;
    this._abortController = null;
  }

  _setState(status) {
    if (status === this._state) return;
    this._state = status;
    this.onState({ status });
  }

  start() {
    const ctx = this.context;
    if (this._disposed || !ctx || ctx.state === 'closed') return Promise.resolve(false);
    if (this.source) return Promise.resolve(true);
    if (this._startPromise) return this._startPromise;

    // Save the shared promise before starting work: enter and microphone can race.
    this._startPromise = Promise.resolve().then(async () => {
      const live = () => !this._disposed && this.context === ctx && ctx.state !== 'closed';
      try {
        if (!live()) return false;
        this._setState('loading');
        this._abortController = new AbortController();
        const response = await fetch('./assets/starlight-piano.mp3', { signal: this._abortController.signal });
        if (!live()) return false;
        if (!response.ok) throw new Error('Music could not be loaded');
        const bytes = await response.arrayBuffer();
        if (!live()) return false;
        const buffer = await ctx.decodeAudioData(bytes);
        if (!live()) return false;

        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(ctx.destination);
        this.source = ctx.createBufferSource();
        this.source.buffer = buffer;
        this.source.loop = true;
        this.source.connect(this.gain);
        this.source.start();
        // Never replace a mute/duck decision made while the file was loading.
        this.setLevel(this._desiredLevel, 1.8);
        return true;
      } catch (error) {
        this._releaseNodes();
        if (live()) this._setState('error');
        return false;
      } finally {
        this._abortController = null;
        this._startPromise = null;
      }
    });
    return this._startPromise;
  }

  setLevel(level, ramp = 1.8) {
    if (this._disposed) return;
    this._desiredLevel = Math.max(0, Math.min(1, Number(level) || 0));
    if (!this.gain || !this.context || this.context.state === 'closed') return;
    const param = this.gain.gain, now = this.context.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else {
      const current = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    }
    param.linearRampToValueAtTime(this._desiredLevel, now + Math.max(.015, ramp));
    this._setState(this._desiredLevel > 0 ? 'playing' : 'muted');
  }

  _releaseNodes() {
    try { this.source?.stop(); } catch (_) { /* source may already be stopped */ }
    this.source?.disconnect();
    this.gain?.disconnect();
    this.source = null;
    this.gain = null;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._abortController?.abort();
    this._releaseNodes();
    this.context = null;
    this._setState('disposed');
  }
}
