(() => {
  const video = document.getElementById('rtsp-video');
  const status = document.getElementById('stream-status');

  if (!video || !(video instanceof HTMLVideoElement)) {
    return;
  }

  const src = video.dataset.src;
  if (!src) {
    return;
  }

  const withCacheBust = (value) => {
    const joiner = value.includes('?') ? '&' : '?';
    return `${value}${joiner}ts=${Date.now()}`;
  };

  const setStatus = (message, isError) => {
    if (!status) {
      return;
    }
    status.textContent = message;
    if (isError) {
      status.classList.add('error');
    } else {
      status.classList.remove('error');
    }
  };

  let lastReconnectAt = 0;
  let hlsInstance = null;

  const reconnect = (message) => {
    const now = Date.now();
    if (now - lastReconnectAt < 3000) {
      return;
    }
    lastReconnectAt = now;
    setStatus(message, true);
    if (hlsInstance) {
      hlsInstance.startLoad();
      return;
    }
    video.src = withCacheBust(src);
    video.play().catch(() => undefined);
  };

  const startNative = () => {
    video.src = withCacheBust(src);
    video.addEventListener('loadeddata', () => setStatus(''), { once: true });
  };

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    startNative();
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.15';
  script.onload = () => {
    const Hls = window.Hls;
    if (!Hls || !Hls.isSupported()) {
      setStatus('This browser does not support live streaming.', true);
      return;
    }

    const hls = new Hls({ lowLatencyMode: true });
    hlsInstance = hls;
    hls.loadSource(withCacheBust(src));
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setStatus('');
      video.play().catch(() => undefined);
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data?.fatal) {
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        reconnect('Stream interrupted. Reconnecting...');
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        setStatus('Stream hiccup. Recovering...', true);
        hls.recoverMediaError();
        return;
      }
      setStatus('Stream stopped. Reload the page to reconnect.', true);
      hls.destroy();
    });
  };
  script.onerror = () => setStatus('Failed to load the video player.', true);
  document.head.appendChild(script);

  video.addEventListener('stalled', () => reconnect('Stream stalled. Reconnecting...'));
  video.addEventListener('error', () => reconnect('Stream error. Reconnecting...'));
})();
