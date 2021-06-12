'use strict';

// Generator function that yields the Cartesian product of the given iterables.
exports.cartesian = function* (head, ...tail) {
  const remainder = tail.length > 0 ? exports.cartesian(...tail) : [[]];
  for (const r of remainder) for (const h of head) yield [h, ...r];
};

const makeSilentAudioTrack = () => {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const dst = oscillator.connect(ctx.createMediaStreamDestination());
  oscillator.start();
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
  ctx.fillStyle = `#${Math.floor(Math.random() * 2 ** 24).toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
