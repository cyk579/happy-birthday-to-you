/** Camera capture and inference lifecycle. No images are recorded or uploaded. */
export class HandTracking {
  constructor({video, onState = () => {}, onFrame = () => {}}) {
    this.video = video;
    this.onState = onState;
    this.onFrame = onFrame;
    this.worker = null;
    this.stream = null;
    this._session = 0;
    this._active = false;
    this._disposed = false;
    this._raf = null;
    this._timeout = null;
    this._busy = false;
    this._lastVideoTime = -1;
    this._lastSent = -Infinity;
    this._rejectReady = null;
    this._startPromise = null;
  }

  start() {
    if (this._disposed) return Promise.resolve(false);
    if (this._active) return this._startPromise || Promise.resolve(true);
    if (!navigator.mediaDevices?.getUserMedia || typeof Worker === 'undefined' ||
        typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      this.onState({status: 'error', message: '此浏览器暂不支持手势控制，请使用新版 Chrome 或 Edge'});
      return Promise.resolve(false);
    }
    const session = ++this._session;
    this._active = true;
    this.onState({status: 'loading', message: '正在准备手势识别，请允许使用摄像头'});
    const live = () => this._active && this._session === session && !this._disposed;

    this._startPromise = (async () => {
      try {
        const worker = new Worker(new URL('./gesture-worker.js', import.meta.url));
        this.worker = worker;
        const ready = new Promise((resolve, reject) => {
          this._rejectReady = reject;
          this._timeout = setTimeout(() => reject(new Error('MODEL_TIMEOUT')), 45000);
          worker.onmessage = ({data}) => {
            if (!live()) return;
            if (data.type === 'ready') {
              clearTimeout(this._timeout);
              this._timeout = null;
              this._rejectReady = null;
              resolve();
            } else if (data.type === 'result') {
              this._busy = false;
              this.onFrame(data);
            } else if (data.type === 'error') {
              reject(new Error('MODEL_ERROR'));
              this._fail(session, '手势识别暂时不可用，关闭后可重新尝试');
            }
          };
          worker.onerror = () => {
            reject(new Error('MODEL_ERROR'));
            this._fail(session, '手势识别暂时不可用，关闭后可重新尝试');
          };
        });
        // Observe cancellation even if synchronous setup fails before Promise.all.
        void ready.catch(() => {});
        worker.postMessage({type: 'init'});
        const camera = navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 20, max: 24}},
        }).then(async stream => {
          // Permission can resolve after Close, a worker failure, or page teardown.
          if (!live()) { stream.getTracks().forEach(track => track.stop()); return; }
          this.stream = stream;
          stream.getVideoTracks().forEach(track => {
            track.onended = () => this._fail(session, '摄像头连接已中断，请重新开启');
          });
          this.video.srcObject = stream;
          await this.video.play();
        });
        // Attach both rejections immediately, even while a permission prompt stays open.
        await Promise.all([ready, camera]);
        if (!live()) return false;
        this.onState({status: 'ready', message: '把一只手放到镜头前'});
        this._schedule(session);
        return true;
      } catch (error) {
        if (live()) {
          const message = error.name === 'NotAllowedError' || error.name === 'SecurityError'
            ? '摄像头未获允许，可在地址栏授权后重试'
            : error.name === 'NotFoundError' ? '没有找到摄像头，请连接后重试'
            : error.name === 'NotReadableError' ? '摄像头正被其他程序占用，请关闭后重试'
            : error.message === 'MODEL_TIMEOUT' ? '识别资源加载较慢，请稍后重新开启'
            : '暂时无法开启手势控制，关闭后可重新尝试';
          this._fail(session, message);
        }
        return false;
      } finally {
        if (this._session === session) this._startPromise = null;
      }
    })();
    return this._startPromise;
  }

  _schedule(session) {
    if (!this._active || this._session !== session) return;
    this._raf = requestAnimationFrame(now => {
      if (!this._active || this._session !== session) return;
      if (this._busy && now - this._lastSent > 8000) {
        this._fail(session, '手势识别已暂停，请重新开启');
        return;
      }
      // One frame in flight, at most 15 inferences/s; cake rendering stays independent.
      if (!this._busy && now - this._lastSent >= 66 && this.video.readyState >= 2 &&
          this.video.currentTime !== this._lastVideoTime) {
        this._busy = true;
        this._lastSent = now;
        this._lastVideoTime = this.video.currentTime;
        createImageBitmap(this.video).then(bitmap => {
          if (!this._active || this._session !== session) { bitmap.close(); return; }
          try {
            this.worker.postMessage({type: 'frame', bitmap, timestamp: now}, [bitmap]);
          } catch (error) {
            bitmap.close();
            throw error;
          }
        }).catch(() => this._fail(session, '暂时无法读取摄像头画面，请重新开启'));
      }
      this._schedule(session);
    });
  }

  _fail(session, message) {
    if (!this._active || this._session !== session || this._disposed) return;
    this._release();
    this.onState({status: 'error', message});
  }

  _release() {
    this._active = false;
    this._session++;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._timeout);
    this._rejectReady?.(new Error('CANCELLED'));
    this._rejectReady = null;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this._raf = this._timeout = this._startPromise = null;
    this._busy = false;
    this._lastVideoTime = -1;
    this._lastSent = -Infinity;
  }

  stop() {
    this._release();
    if (!this._disposed) this.onState({status: 'off', message: '摄像头已关闭'});
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._release();
  }
}
