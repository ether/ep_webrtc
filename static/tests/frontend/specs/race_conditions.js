'use strict';

const {fakeGetUserMedia} = require('ep_webrtc/static/tests/frontend/utils');

describe('Race conditions that leave audio/video track enabled', function () {
  // The idea here is to place high value on making sure that the "mute" and "video-off" buttons in
  // the video interfaces match with the audioTrack.enabled/videoTrack.enabled, so that users don't
  // get the wrong idea about whether the audio or video feed are on.
  //
  // These tests are various ideas for trying to do things in quick succession
  // or "at the same time". We can add more if we think of them.

  for (const enabledOnStart of [false, true]) {
    describe(`audio and video ${enabledOnStart ? 'en' : 'dis'}abled on start`, function () {
      let chrome$;

      const getVideo = () => chrome$('video')[0];
      const getStream = () => getVideo().srcObject;
      const assertTracks = (enabled = enabledOnStart) => {
        if (enabled) {
          expect(getStream().getTracks().length).to.equal(2);
          expect(getStream().getTracks().every((t) => t.enabled)).to.be(true);
        } else {
          expect(getStream().getTracks().some((t) => t.enabled)).to.be(false);
        }
        const [audio] = getStream().getAudioTracks();
        const [video] = getStream().getVideoTracks();
        expect(chrome$('.audio-btn').hasClass('muted')).to.equal(audio == null || !audio.enabled);
        expect(chrome$('.video-btn').hasClass('off')).to.equal(video == null || !video.enabled);
      };

      beforeEach(async function () {
        this.timeout(60000);
        await helper.aNewPad({
          padPrefs: {
            audioEnabledOnStart: enabledOnStart,
            videoEnabledOnStart: enabledOnStart,
          },
          // Disable WebRTC so we can install a fake getUserMedia() before it is called.
          params: {av: false},
        });
        chrome$ = helper.padChrome$;
        chrome$.window.navigator.mediaDevices.getUserMedia = fakeGetUserMedia;
        chrome$('#options-enablertc').click();
        await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
        const ownVideoId = `video_${chrome$.window.ep_webrtc.getUserId().replace(/\./g, '_')}`;
        await helper.waitForPromise(() => getVideo() != null);
        const $interface = chrome$(`#interface_${ownVideoId}`);
        expect($interface.length).to.equal(1);
        expect(chrome$('.audio-btn').length).to.equal(1);
        expect(chrome$('.video-btn').length).to.equal(1);
        await helper.waitForPromise(
            () => getStream() != null && (!enabledOnStart || getStream().getTracks().length === 2));
        assertTracks();
      });

      // See if we can trip up the state by "deactivating" webrtc, clicking mute/video-off, and
      // "activating" webrtc in quick succession. As of this writing, "deactivating" will make the
      // buttons disappear pretty quickly, making the "click" ineffectual, regardless, but in case
      // we ever change things around, perhaps this test will catch something.
      it('deactivate, click, activate', async function () {
        for (let i = 0; i < 10; ++i) {
          const [oldAudioTrack] = getStream().getAudioTracks();
          const [oldVideoTrack] = getStream().getVideoTracks();

          await chrome$.window.ep_webrtc.deactivate();
          chrome$('.audio-btn').click();
          chrome$('.video-btn').click();
          await chrome$.window.ep_webrtc.activate();

          assertTracks();

          const [newAudioTrack] = getStream().getAudioTracks();
          const [newVideoTrack] = getStream().getVideoTracks();

          if (enabledOnStart) {
            expect(newAudioTrack).to.not.equal(oldAudioTrack);
            expect(oldAudioTrack.readyState).to.equal('ended');
            expect(newAudioTrack.readyState).to.equal('live');

            expect(newVideoTrack).to.not.equal(oldVideoTrack);
            expect(oldVideoTrack.readyState).to.equal('ended');
            expect(newVideoTrack.readyState).to.equal('live');
          }
        }
      });

      // See if we can trip up the state by clicking mute/video-off, "deactivating" webrtc, and
      // "activating" webrtc in quick succession
      it('click, deactivate, activate', async function () {
        for (let i = 0; i < 10; ++i) {
          const [oldAudioTrack] = getStream().getAudioTracks();
          const [oldVideoTrack] = getStream().getVideoTracks();

          chrome$('.audio-btn').click();
          chrome$('.video-btn').click();
          await chrome$.window.ep_webrtc.deactivate();
          await chrome$.window.ep_webrtc.activate();

          assertTracks();

          const [newAudioTrack] = getStream().getAudioTracks();
          const [newVideoTrack] = getStream().getVideoTracks();

          if (enabledOnStart) {
            expect(newAudioTrack).to.not.equal(oldAudioTrack);
            expect(oldAudioTrack.readyState).to.equal('ended');
            expect(newAudioTrack.readyState).to.equal('live');

            expect(newVideoTrack).to.not.equal(oldVideoTrack);
            expect(oldVideoTrack.readyState).to.equal('ended');
            expect(newVideoTrack.readyState).to.equal('live');
          }
        }
      });

      // See if we can trip up the state by "deactivating" webrtc, "activating" webrtc, and then
      // clicking mute/video-off right after the interface returns.
      it('deactivate, activate, click', async function () {
        for (let i = 0; i < 10; ++i) {
          const [oldAudioTrack] = getStream().getAudioTracks();
          const [oldVideoTrack] = getStream().getVideoTracks();

          await chrome$.window.ep_webrtc.deactivate();
          const p = chrome$.window.ep_webrtc.activate();
          await helper.waitForPromise(
              () => chrome$ && chrome$('.interface-container').length === 1, 2000);
          chrome$('.audio-btn').click();
          chrome$('.video-btn').click();
          await Promise.all([
            p,
            chrome$('.audio-btn').data('idle')('click'),
            chrome$('.video-btn').data('idle')('click'),
          ]);

          assertTracks(!enabledOnStart);

          const [newAudioTrack] = getStream().getAudioTracks();
          const [newVideoTrack] = getStream().getVideoTracks();

          expect(newAudioTrack).to.not.equal(oldAudioTrack);
          if (oldAudioTrack != null) expect(oldAudioTrack.readyState).to.equal('ended');
          if (newAudioTrack != null) expect(newAudioTrack.readyState).to.equal('live');

          expect(newVideoTrack).to.not.equal(oldVideoTrack);
          if (oldVideoTrack != null) expect(oldVideoTrack.readyState).to.equal('ended');
          if (newVideoTrack != null) expect(newVideoTrack.readyState).to.equal('live');
        }
      });

      // See if we can trip up the state by clicking mute/video-off, "deactivating"/"activating"
      // webrtc, as close to at the same time as we can
      it('click while reactivate', async function () {
        for (let i = 0; i < 10; i++) {
          const [oldAudioTrack] = getStream().getAudioTracks();
          const [oldVideoTrack] = getStream().getVideoTracks();

          await chrome$.window.ep_webrtc.deactivate();
          const p = chrome$.window.ep_webrtc.activate();
          chrome$('.audio-btn').click();
          chrome$('.video-btn').click();
          await Promise.all([
            p,
            chrome$('.audio-btn').data('idle')(),
            chrome$('.video-btn').data('idle')(),
          ]);

          assertTracks(!enabledOnStart);

          const [newAudioTrack] = getStream().getAudioTracks();
          const [newVideoTrack] = getStream().getVideoTracks();

          if (!enabledOnStart) {
            expect(newAudioTrack).to.not.equal(oldAudioTrack);
            if (oldAudioTrack != null) expect(oldAudioTrack.readyState).to.equal('ended');
            if (newAudioTrack != null) expect(newAudioTrack.readyState).to.equal('live');

            expect(newVideoTrack).to.not.equal(oldVideoTrack);
            if (oldVideoTrack != null) expect(oldVideoTrack.readyState).to.equal('ended');
            if (newVideoTrack != null) expect(newVideoTrack.readyState).to.equal('live');
          }
        }
      });

      // See if we can trip up the state by clicking mute/video-off many times at once. We click
      // mute an odd number of times and video-off an even number of times.
      it('many clicks', async function () {
        for (let i = 0; i < 10; ++i) {
          chrome$('.audio-btn').click();
          chrome$('.audio-btn').click();
          chrome$('.audio-btn').click();
          chrome$('.video-btn').click();
          chrome$('.video-btn').click();
          await Promise.all([
            chrome$('.audio-btn').data('idle')(),
            chrome$('.video-btn').data('idle')(),
          ]);
          expect(chrome$('.audio-btn').hasClass('muted'))
              .to.equal(((i + 1) * 3 + (enabledOnStart ? 1 : 0)) % 2 === 0);
          expect(chrome$('.video-btn').hasClass('off'))
              .to.equal(((i + 1) * 2 + (enabledOnStart ? 1 : 0)) % 2 === 0);
        }
      });
    });
  }
});
