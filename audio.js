/**
 * Small WebAudio controller for the birthday scene.
 * Microphone samples stay in the browser and are never recorded or uploaded.
 */
export class BirthdayAudio {
  constructor(onMicState = () => {}) {
    this.onMicState = typeof onMicState === "function" ? onMicState : () => {};
    this.audioContext = null;
    this.ambientGain = null;
    this.ambientNodes = [];
    this.micStream = null;
    this.micSource = null;
    this.analyser = null;
    this.timeData = null;
    this.frequencyData = null;

    this._micState = "off";
    this._micMessage = "麦克风尚未开启";
    this._calibrationElapsed = 0;
    this._calibrationRms = 0;
    this._calibrationBand = 0;
    this._noiseFloor = 0.018;
    this._bandFloor = 0.012;
    this._strength = 0;
    this._muted = false;
    this._ducked = false;
    this._disposed = false;
    this._micRequestToken = 0;
  }

  _setMicState(status, message) {
    this._micState = status;
    this._micMessage = message;
    this.onMicState({ status, message });
  }

  /** Create/resume the context and start a quiet, continuously evolving sound bed. */
  async start() {
    if (this._disposed) return false;
    try {
      if (!this.audioContext) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) throw new Error("Web Audio API unavailable");
        this.audioContext = new AudioContextCtor();
      }
      if (this.audioContext.state === "suspended") await this.audioContext.resume();
      if (!this.ambientGain) this._createAmbient();
      return true;
    } catch (error) {
      // Audio is optional: the visual experience can continue without it.
      this._setMicState("error", "音频无法启动，但仍可继续体验");
      return false;
    }
  }

  _createAmbient() {
    const ctx = this.audioContext;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0;
    this.ambientGain.connect(ctx.destination);

    // Three detuned drones plus very slow gain motion make an atmosphere without
    // a short musical loop that would become obvious over time.
    const voices = [
      [196.0, 0.014, 0.031],
      [246.94, 0.010, 0.047],
      [293.66, 0.007, 0.067],
    ];
    for (const [frequency, level, lfoRate] of voices) {
      const voice = ctx.createGain();
      voice.gain.value = level;
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = "sine";
      lfo.frequency.value = lfoRate;
      lfoGain.gain.value = level * 0.28;
      lfo.connect(lfoGain).connect(voice.gain);

      oscillator.connect(voice).connect(this.ambientGain);
      oscillator.start();
      lfo.start();
      this.ambientNodes.push(oscillator, lfo, lfoGain, voice);
    }
    this._applyAmbientLevel(0.045, 0.8);
  }

  _applyAmbientLevel(level, ramp = 0.18) {
    if (!this.ambientGain || !this.audioContext) return;
    const target = this._muted ? 0 : level * (this._ducked ? 0.22 : 1);
    const now = this.audioContext.currentTime;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setTargetAtTime(target, now, Math.max(0.015, ramp));
  }

  setMuted(muted) {
    this._muted = Boolean(muted);
    this._applyAmbientLevel(0.045, 0.12);
  }

  setDucked(ducked) {
    this._ducked = Boolean(ducked);
    this._applyAmbientLevel(0.045, 0.2);
  }

  /** Request microphone permission and prepare an analyser; no audio is emitted. */
  async enableMic() {
    if (this._disposed) return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      this._setMicState("error", "此浏览器不支持麦克风访问");
      return false;
    }
    if (this.micStream && this.analyser) return true;
    const requestToken = ++this._micRequestToken;
    this._setMicState("requesting", "正在请求麦克风权限");
    try {
      const started = await this.start();
      if (!started || !this.audioContext) throw new Error("AudioContext unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      // A permission prompt can outlive a user cancellation or page teardown.
      if (requestToken !== this._micRequestToken || this._disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.micStream = stream;
      const ctx = this.audioContext;
      this.micSource = ctx.createMediaStreamSource(this.micStream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.42;
      this.micSource.connect(this.analyser); // analyser has no destination connection
      this.timeData = new Float32Array(this.analyser.fftSize);
      this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
      this._calibrationElapsed = 0;
      this._calibrationRms = 0;
      this._calibrationBand = 0;
      this._strength = 0;
      this._setMicState("calibrating", "请保持安静，正在校准环境声音");
      return true;
    } catch (error) {
      this.disableMic(false);
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      this._setMicState("error", denied ? "麦克风权限未开启，可稍后重试" : "麦克风暂时不可用");
      return false;
    }
  }

  /** Stop tracks and disconnect analyser nodes while preserving the sound bed. */
  disableMic(announce = true) {
    this._micRequestToken += 1;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micSource?.disconnect();
    this.analyser?.disconnect();
    this.micStream = null;
    this.micSource = null;
    this.analyser = null;
    this.timeData = null;
    this.frequencyData = null;
    this._calibrationElapsed = 0;
    this._strength = 0;
    if (announce) this._setMicState("off", "麦克风已暂停");
  }

  /**
   * Read one analyser frame. `dt` is seconds since the previous call; no RAF is
   * scheduled here so the render loop remains owned by the scene.
   */
  sample(dt = 1 / 60) {
    if (!this.analyser || !this.timeData || !this.frequencyData) return { strength: 0, ready: false };
    const elapsed = Math.min(Math.max(Number(dt) || 1 / 60, 1 / 240), 0.2);
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getFloatFrequencyData(this.frequencyData);

    let rmsSum = 0;
    for (const value of this.timeData) rmsSum += value * value;
    const rms = Math.sqrt(rmsSum / this.timeData.length);

    // Average the 300 Hz-8 kHz band, where breath noise is concentrated.
    const nyquist = this.audioContext.sampleRate / 2;
    const lowBin = Math.max(1, Math.floor((300 / nyquist) * this.frequencyData.length));
    const highBin = Math.min(this.frequencyData.length - 1, Math.ceil((8000 / nyquist) * this.frequencyData.length));
    let bandSum = 0;
    let bandCount = 0;
    for (let i = lowBin; i <= highBin; i += 1) {
      const db = this.frequencyData[i];
      if (Number.isFinite(db)) {
        bandSum += Math.pow(10, db / 20);
        bandCount += 1;
      }
    }
    const band = bandCount ? bandSum / bandCount : 0;

    if (this._micState === "calibrating") {
      const weight = Math.min(1, elapsed);
      this._calibrationRms += rms * weight;
      this._calibrationBand += band * weight;
      this._calibrationElapsed += elapsed;
      if (this._calibrationElapsed >= 1) {
        const duration = this._calibrationElapsed;
        this._noiseFloor = Math.max(0.006, this._calibrationRms / duration);
        this._bandFloor = Math.max(0.004, this._calibrationBand / duration);
        this._setMicState("on", "正在聆听你的气息");
      }
      return { strength: 0, ready: false };
    }

    const rmsExcess = Math.max(0, rms - this._noiseFloor * 1.12 - 0.0015);
    const bandExcess = Math.max(0, band - this._bandFloor * 1.15 - 0.001);
    const rmsScore = Math.min(1, rmsExcess / 0.075);
    const bandScore = Math.min(1, bandExcess / 0.04);
    const raw = Math.min(1, rmsScore * 0.74 + bandScore * 0.26);
    const smoothing = 1 - Math.exp(-elapsed * 12);
    this._strength += (raw - this._strength) * smoothing;
    return { strength: Math.max(0, Math.min(1, this._strength)), ready: true };
  }

  dispose() {
    if (this._disposed) return;
    this.disableMic(false);
    for (const node of this.ambientNodes) {
      try { node.stop?.(); } catch (_) { /* already stopped */ }
      try { node.disconnect?.(); } catch (_) { /* disconnected */ }
    }
    this.ambientNodes = [];
    this.ambientGain?.disconnect();
    this.ambientGain = null;
    this.audioContext?.close?.();
    this.audioContext = null;
    this._disposed = true;
    this._setMicState("off", "音频已释放");
  }
}

export default BirthdayAudio;
