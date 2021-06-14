'use strict';

// Generator function that yields the Cartesian product of the given iterables.
exports.cartesian = function* (head, ...tail) {
  const remainder = tail.length > 0 ? exports.cartesian(...tail) : [[]];
  for (const r of remainder) for (const h of head) yield [h, ...r];
};

const makeSilentAudioTrack = () => {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  const dst = gain.connect(ctx.createMediaStreamDestination());
  return dst.stream.getAudioTracks()[0];
};

const makeVideoTrack = (constraints) => {
  const canvas = helper.padChrome$.window.document.createElement('canvas');
  const {
    width: {max: widthMax = 160, ideal: widthIdeal} = {},
    height: {max: heightMax = 120, ideal: heightIdeal} = {},
  } = constraints;
  canvas.width = widthIdeal || widthMax;
  canvas.height = heightIdeal || heightMax;
  const ctx = canvas.getContext('2d');
  // Some animation is needed because in some browsers HTMLVideoElement.play() will hang until the
  // canvas is updated. The pad's window.setInterval is called in the hopes that the interval will
  // be automatically stopped once the pad is unloaded.
  helper.padChrome$.window.setInterval(() => {
    ctx.fillStyle = `#${Math.floor(Math.random() * 2 ** 24).toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, 100); // Use a relatively high frame rate to speed up tests.
  return canvas.captureStream().getVideoTracks()[0];
};

// Creates dummy audio and/or video tracks. Limitations:
//   - Most browsers prohibit audio until there has been some user interaction with the page or
//     the real getUserMedia() has been called.
exports.fakeGetUserMedia = async ({audio, video}) => {
  if (!audio && !video) throw new DOMException('either audio or video is required', 'TypeError');
  return new MediaStream([
    ...(audio ? [makeSilentAudioTrack()] : []),
    ...(video ? [makeVideoTrack(video)] : []),
  ]);
};
