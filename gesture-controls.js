const HOLD_MS = { flip: 650, reset: 800 };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Camera-independent gesture state machine. Landmark coordinates are normalized. */
export class GestureControls {
  constructor({ onGrab = () => {}, onRotate = () => {}, onFlip = () => {}, onReset = () => {} } = {}) {
    this.onGrab = onGrab;
    this.onRotate = onRotate;
    this.onFlip = onFlip;
    this.onReset = onReset;
    this._grabbing = false;
    this.reset();
  }

  _releaseGrab() {
    if (this._grabbing) {
      this._grabbing = false;
      this.onGrab(false);
    }
    this._anchor = null;
    this._dragMode = null;
  }

  _clearHold() {
    this._candidate = null;
    this._holdMs = 0;
    this._gapMs = 0;
    this._graceUsed = false;
    this._matched = false;
  }

  reset() {
    this._releaseGrab();
    this._clearHold();
    this._lastTime = null;
    this._latched = null;
    this._releaseMs = 0;
  }

  _updateHold(pose, dt) {
    if (this._latched) {
      if (pose === this._latched) {
        this._releaseMs = 0;
        return { mode: this._latched, progress: 1 };
      }
      this._releaseMs += dt;
      if (!pose && this._releaseMs < 180) return { mode: this._latched, progress: 1 };
      this._latched = null;
      this._releaseMs = 0;
      this._clearHold();
    }

    if (pose) {
      this._releaseGrab(); // A recognized fist takes priority over its short thumb/index gap.
      if (pose !== this._candidate) {
        this._clearHold();
        this._candidate = pose;
      } else if (this._matched) {
        this._holdMs += dt;
      } else if (this._gapMs + dt <= 160 && !this._graceUsed) {
        // Tolerate one brief classifier miss, without counting its time toward a hold.
        this._graceUsed = true;
      } else {
        this._holdMs = 0;
        this._graceUsed = false;
      }
      this._matched = true;
      this._gapMs = 0;
      const progress = clamp(this._holdMs / HOLD_MS[pose], 0, 1);
      if (progress === 1) {
        this._latched = pose;
        this._releaseMs = 0;
        this._clearHold();
        if (pose === 'flip') this.onFlip();
        else this.onReset();
      }
      return { mode: pose, progress };
    }

    if (this._candidate) {
      this._gapMs += dt;
      this._matched = false;
      if (this._gapMs <= 120 && !this._graceUsed) {
        return { mode: this._candidate, progress: this._holdMs / HOLD_MS[this._candidate] };
      }
      // Repeated or long interruptions start a new hold; separate V flashes cannot add up.
      this._clearHold();
    }
    return null;
  }

  update({ landmarks, gesture, score } = {}, nowMilliseconds) {
    const now = Number(nowMilliseconds);
    const valid = Number.isFinite(now) && Array.isArray(landmarks) && landmarks.length === 21 &&
      landmarks.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
        (p.z === undefined || Number.isFinite(p.z)) && p.x >= -.1 && p.x <= 1.1 && p.y >= -.1 && p.y <= 1.1);
    if (!valid) {
      this.reset();
      return { mode: 'searching', progress: 0 };
    }
    const width = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y);
    if (width < .035 || width > .8) {
      this.reset();
      return { mode: 'searching', progress: 0 };
    }

    let dt = this._lastTime === null ? 0 : now - this._lastTime;
    if (dt < 0 || dt > 250) {
      this._releaseGrab();
      this._clearHold();
      dt = 0;
    }
    this._lastTime = now;
    let cursor = {
      x: clamp(1 - (landmarks[4].x + landmarks[8].x) / 2, 0, 1),
      y: clamp((landmarks[4].y + landmarks[8].y) / 2, 0, 1),
    };
    const confidence = Number.isFinite(score) ? score : 0;
    const pose = gesture === 'Closed_Fist' && confidence > .75 ? 'reset' :
      gesture === 'Victory' && confidence > .7 ? 'flip' : null;
    const hold = this._updateHold(pose, dt);
    if (hold) return { ...hold, cursor };

    const ratio = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y) / width;
    // A stable open palm is enough to turn the scene; confidence hysteresis prevents flicker.
    const waving = gesture === 'Open_Palm' && confidence > (this._dragMode === 'waving' ? .45 : .55);
    const pinching = ratio < (this._dragMode === 'grabbing' ? .48 : .35);
    const mode = waving ? 'waving' : pinching ? 'grabbing' : null;
    if (waving) {
      // Use the palm center rather than fingertips, which move while the fingers flex.
      const palm = [0, 5, 9, 13, 17].map(index => landmarks[index]);
      cursor = {
        x: clamp(1 - palm.reduce((sum, point) => sum + point.x, 0) / palm.length, 0, 1),
        y: clamp(palm.reduce((sum, point) => sum + point.y, 0) / palm.length, 0, 1),
      };
    }
    if (!mode) {
      this._releaseGrab();
      return { mode: 'ready', progress: 0, cursor };
    }
    if (!this._grabbing || mode !== this._dragMode) {
      this._releaseGrab();
      this._grabbing = true;
      this._dragMode = mode;
      this._anchor = cursor;
      this.onGrab(true);
      return { mode, progress: 0, cursor };
    }
    if (this._grabbing) {
      const dx = cursor.x - this._anchor.x, dy = cursor.y - this._anchor.y;
      // Re-anchor on a detection jump instead of passing a large rotation to the scene.
      if (Math.hypot(dx, dy) > .18) {
        this._releaseGrab();
        this._grabbing = true;
        this._dragMode = mode;
        this.onGrab(true);
      } else if (dt > 0 && Math.abs(dx) + Math.abs(dy) > 1e-6) {
        this.onRotate(dx * 5, dy * 3.2);
      }
      this._anchor = cursor;
      return { mode, progress: 0, cursor };
    }
    return { mode: 'ready', progress: 0, cursor };
  }
}
