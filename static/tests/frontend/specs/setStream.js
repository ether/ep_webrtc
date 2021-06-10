'use strict';

const {cartesian} = require('ep_webrtc/static/tests/frontend/utils');

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
  const fakeGetUserMedia = async ({audio, video}) => {
    if (!audio && !video) throw new DOMException('either audio or video is required', 'TypeError');
    return new MediaStream([
      ...(audio ? [makeSilentAudioTrack()] : []),
      ...(video ? [makeVideoTrack()] : []),
    ]);
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
            params: Object.assign({av: false}, tc.params),
          });
          chrome$ = helper.padChrome$;
          chrome$.window.navigator.mediaDevices.getUserMedia = fakeGetUserMedia;
          chrome$('#options-enablertc').click();
          await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
          ownUserId = chrome$.window.ep_webrtc.getUserId();
          ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
          ownInterfaceId = `interface_${ownVideoId}`;
          const peerStream =
              tc.peer.audio || tc.peer.video ? await fakeGetUserMedia(tc.peer) : new MediaStream();
          await chrome$.window.ep_webrtc.setStream(otherUserId, peerStream);
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
          // Only initially muted if the browser doesn't give permission to autoplay unless muted.
          // (A peer without an audio track might later add an audio track; if so, the audio should
          // start playing locally without the local user clicking anything.)
          expect($audioBtn.hasClass('muted')).to.equal(chrome$(`#${otherVideoId}`).prop('muted'));
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
      chrome$.window.navigator.mediaDevices.getUserMedia = fakeGetUserMedia;
      chrome$.window.clientVars.webrtc.audio.disabled = 'hard';
      chrome$.window.clientVars.webrtc.video.disabled = 'hard';
      chrome$('#options-enablertc').click();
      await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
      ownUserId = chrome$.window.ep_webrtc.getUserId();
      ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
      ownInterfaceId = `interface_${ownVideoId}`;
      await chrome$.window.ep_webrtc.setStream(otherUserId, new MediaStream());
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
      // Mute state only depends on whether the browser gives permission to autoplay when unmuted.
      // Hard disabling only affects what the local client sends; it doesn't affect what the remote
      // peer sends. (Both the local client and the remote peer should see the same settings,
      // however.)
      expect($audioBtn.hasClass('muted')).to.equal(chrome$(`#${otherVideoId}`).prop('muted'));
      const $videoBtn = chrome$(`#${otherInterfaceId} .video-btn`);
      expect($videoBtn.length).to.equal(0);
      const $enlargeBtn = chrome$(`#${otherInterfaceId} .enlarge-btn`);
      expect($enlargeBtn.length).to.equal(1);
      expect($enlargeBtn.hasClass('large')).to.equal(false);
    });
  });
});
