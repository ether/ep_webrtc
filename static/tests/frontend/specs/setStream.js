'use strict';

const {cartesian, fakeGetUserMedia} = require('ep_webrtc/static/tests/frontend/utils');

describe('setStream()', function () {
  let chrome$;
  const otherUserId = 'other_user_id';
  const otherVideoId = `video_${otherUserId.replace(/\./g, '_')}`;
  const otherInterfaceId = `interface_${otherVideoId}`;
  let ownUserId, ownVideoId, ownInterfaceId;

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
          // Clicking $(#options-enablertc) also activates, but calling activate() directly blocks
          // until activation is complete.
          await chrome$.window.ep_webrtc.activate();
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
          // Disable WebRTC so we can modify settings and install a fake getUserMedia() before
          // WebRTC stuff is initialized.
          av: false,
          webrtcaudioenabled: true,
          webrtcvideoenabled: true,
        },
      });
      chrome$ = helper.padChrome$;
      chrome$.window.navigator.mediaDevices.getUserMedia = fakeGetUserMedia;
      await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
      chrome$.window.ep_webrtc._settings.audio.disabled = 'hard';
      chrome$.window.ep_webrtc._settings.video.disabled = 'hard';
      // Clicking $(#options-enablertc) also activates, but calling activate() directly blocks until
      // activation is complete.
      await chrome$.window.ep_webrtc.activate();
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
