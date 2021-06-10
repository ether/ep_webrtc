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

const makeVideoTrack = () => {
  const canvas = helper.padChrome$.window.document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `#${Math.floor(Math.random() * 2 ** 24).toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.captureStream().getVideoTracks()[0];
};

// Creates dummy audio and/or video tracks. Limitations:
//   - `audio` and `video` are treated as Booleans (video size requirements are ignored).
//   - Most browsers prohibit audio until there has been some user interaction with the page or
//     the real getUserMedia() has been called.
exports.fakeGetUserMedia = async ({audio, video}) => {
  if (!audio && !video) throw new DOMException('either audio or video is required', 'TypeError');
  return new MediaStream([
    ...(audio ? [makeSilentAudioTrack()] : []),
    ...(video ? [makeVideoTrack()] : []),
  ]);
};
