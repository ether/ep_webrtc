'use strict';

describe('setStream()', function () {
  let chrome$;
  const otherUserId = 'other_user_id';
  const otherVideoId = `video_${otherUserId.replace(/\./g, '_')}`;
  const otherInterfaceId = `interface_${otherVideoId}`;
  let ownUserId, ownVideoId, ownInterfaceId;

  const makeSilentAudioTrack = () => {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    return dst.stream.getAudioTracks()[0];
  };

  const makeVideoTrack = (document, {width = 160, height = 120, fillStyle = null} = {}) => {
    if (fillStyle == null) {
      fillStyle = `#${Math.floor(Math.random() * 2 ** 24).toString(16).padStart(6, '0')}`;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, width, height);
    return canvas.captureStream().getVideoTracks()[0];
  };

  const fakeStream = (document, {audio = true, video = true} = {}) => new MediaStream([
    ...(audio ? [makeSilentAudioTrack()] : []),
    ...(video ? [makeVideoTrack(document)] : []),
  ]);

  const cartesian = function* (head, ...tail) {
    const remainder = tail.length > 0 ? cartesian(...tail) : [[]];
    for (const r of remainder) for (const h of head) yield [h, ...r];
  };

  describe('Audio and video enabled', function () {
    const testCases = [...cartesian(...Array(4).fill([false, true]))].map(
        ([webrtcaudioenabled, webrtcvideoenabled, peerAudio, peerVideo]) => ({
          params: {webrtcaudioenabled, webrtcvideoenabled},
          peer: {audio: peerAudio, video: peerVideo},
        }));

    for (const tc of testCases) {
      describe(JSON.stringify(tc), function () {
        before(async function () {
          this.timeout(60000);
          await helper.aNewPad({
            // Disable WebRTC so we can install a mock getUserMedia() before it is called.
            padPrefs: {rtcEnabled: false},
            params: tc.params,
          });
          chrome$ = helper.padChrome$;
          chrome$.window.navigator.mediaDevices.getUserMedia =
              (constraints) => fakeStream(chrome$.window.document, constraints);
          chrome$('#options-enablertc').click();
          await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
          ownUserId = chrome$.window.ep_webrtc.getUserId();
          ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
          ownInterfaceId = `interface_${ownVideoId}`;
          chrome$.window.ep_webrtc.setStream(
              otherUserId, fakeStream(chrome$.window.document, tc.peer));
        });

        it('self and peer elements exist', async function () {
          expect(chrome$('.interface-container').length).to.equal(2);
        });

        it('self interface', async function () {
          // Self view is always muted because users shouldn't hear themselves (otherwise there
          // would be audio feedback).
          expect(chrome$(`#${ownVideoId}`).prop('muted')).to.equal(true);
          const $audioBtn = chrome$(`#${ownInterfaceId} .audio-btn`);
          expect($audioBtn.length).to.equal(1);
          expect($audioBtn.hasClass('muted')).to.equal(!tc.params.webrtcaudioenabled);
          expect($audioBtn.hasClass('disallowed')).to.equal(false);
          const $videoBtn = chrome$(`#${ownInterfaceId} .video-btn`);
          expect($videoBtn.length).to.equal(1);
          expect($videoBtn.hasClass('off')).to.equal(!tc.params.webrtcvideoenabled);
          expect($videoBtn.hasClass('disallowed')).to.equal(false);
          const $enlargeBtn = chrome$(`#${ownInterfaceId} .enlarge-btn`);
          expect($enlargeBtn.length).to.equal(1);
          expect($enlargeBtn.hasClass('large')).to.equal(false);
        });

        it('peer interface', async function () {
          const $audioBtn = chrome$(`#${otherInterfaceId} .audio-btn`);
          expect($audioBtn.length).to.equal(1);
          expect($audioBtn.hasClass('muted')).to.equal(!tc.peer.audio);
          const $videoBtn = chrome$(`#${otherInterfaceId} .video-btn`);
          expect($videoBtn.length).to.equal(0);
          const $enlargeBtn = chrome$(`#${otherInterfaceId} .enlarge-btn`);
          expect($enlargeBtn.length).to.equal(1);
          expect($enlargeBtn.hasClass('large')).to.equal(false);
        });
      });
    }
  });

  describe('Audio and video hard disabled', function () {
    before(async function () {
      this.timeout(60000);
      await helper.aNewPad({
        params: {
          // Disable WebRTC so we can modify clientVars and install a mock getUserMedia() before
          // WebRTC stuff is initialized.
          av: false,
          webrtcaudioenabled: true,
          webrtcvideoenabled: true,
        },
      });
      chrome$ = helper.padChrome$;
      chrome$.window.navigator.mediaDevices.getUserMedia =
          (constraints) => fakeStream(chrome$.window.document, constraints);
      chrome$.window.clientVars.webrtc.audio.disabled = 'hard';
      chrome$.window.clientVars.webrtc.video.disabled = 'hard';
      chrome$('#options-enablertc').click();
      await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
      ownUserId = chrome$.window.ep_webrtc.getUserId();
      ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
      ownInterfaceId = `interface_${ownVideoId}`;
      chrome$.window.ep_webrtc.setStream(
          otherUserId, fakeStream(chrome$.window.document, {audio: false, video: false}));
    });

    it('self and peer elements exist', async function () {
      expect(chrome$('.interface-container').length).to.equal(2);
    });

    it('self interface', async function () {
      expect(chrome$(`#${ownVideoId}`).prop('muted')).to.equal(true);
      const $audioBtn = chrome$(`#${ownInterfaceId} .audio-btn`);
      expect($audioBtn.length).to.equal(1);
      expect($audioBtn.hasClass('muted')).to.equal(true);
      expect($audioBtn.hasClass('disallowed')).to.equal(true);
      const $videoBtn = chrome$(`#${ownInterfaceId} .video-btn`);
      expect($videoBtn.length).to.equal(1);
      expect($videoBtn.hasClass('off')).to.equal(true);
      expect($videoBtn.hasClass('disallowed')).to.equal(true);
      const $enlargeBtn = chrome$(`#${ownInterfaceId} .enlarge-btn`);
      expect($enlargeBtn.length).to.equal(1);
      expect($enlargeBtn.hasClass('large')).to.equal(false);
    });

    it('peer interface', async function () {
      const $audioBtn = chrome$(`#${otherInterfaceId} .audio-btn`);
      expect($audioBtn.length).to.equal(1);
      expect($audioBtn.hasClass('muted')).to.equal(true);
      const $videoBtn = chrome$(`#${otherInterfaceId} .video-btn`);
      expect($videoBtn.length).to.equal(0);
      const $enlargeBtn = chrome$(`#${otherInterfaceId} .enlarge-btn`);
      expect($enlargeBtn.length).to.equal(1);
      expect($enlargeBtn.hasClass('large')).to.equal(false);
    });
  });
});