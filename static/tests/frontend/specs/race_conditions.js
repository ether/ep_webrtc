'use strict';

const {fakeGetUserMedia} = require('ep_webrtc/static/tests/frontend/utils');

describe('Race conditions that leave audio/video track enabled', function () {
  // The idea here is to place high value on making sure that the "mute" and "video-off" buttons in
  // the video interfaces match with the audioTrack.enabled/videoTrack.enabled, so that users don't
  // get the wrong idea about whether the audio or video feed are on.
  //
  // These tests are various ideas for trying to do things in quick succession
  // or "at the same time". We can add more if we think of them.

  let audioTrack;
  let videoTrack;
  let originalAudioTrack;
  let originalVideoTrack;

  // wrap getUserMedia such that it grabs a copy of audio and video tracks for inspection after it's
  // done
  const installFakeGetUserMedia = () => {
    const chrome$ = helper.padChrome$;
    chrome$.window.navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await fakeGetUserMedia(constraints);
      audioTrack = stream.getAudioTracks()[0];
      videoTrack = stream.getVideoTracks()[0];
      return stream;
    };
  };

  // See if we can trip up the state by "deactivating" webrtc, clicking mute/video-off, and
  // "activating" webrtc in quick succession. As of this writing, "deactivating" will make the
  // buttons disappear pretty quickly, making the "click" ineffectual, regardless, but in case we
  // ever change things around, perhaps this test will catch something.
  const testDeactivateClickActivate = async () => {
    const chrome$ = helper.padChrome$;

    for (let i = 0; i < 10; ++i) {
      originalAudioTrack = audioTrack;
      expect(originalAudioTrack).to.equal(audioTrack);
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);

      originalVideoTrack = videoTrack;
      expect(originalVideoTrack).to.equal(videoTrack);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);

      await chrome$.window.ep_webrtc.deactivate();
      chrome$('.audio-btn').click();
      chrome$('.video-btn').click();
      await chrome$.window.ep_webrtc.activate();

      // getUserMedia should give us new audio and video Tracks and disable the old one
      expect(originalAudioTrack).to.not.equal(audioTrack);
      expect(originalAudioTrack.readyState).to.equal('ended');
      expect(audioTrack.readyState).to.equal('live');

      expect(originalVideoTrack).to.not.equal(videoTrack);
      expect(originalVideoTrack.readyState).to.equal('ended');
      expect(videoTrack.readyState).to.equal('live');

      // The mute state should be consistent with icon, wherever they land
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);
    }
  };

  // See if we can trip up the state by clicking mute/video-off,
  // "deactivating" webrtc, and "activating" webrtc in quick succession
  const testClickDeactivateActivate = async () => {
    const chrome$ = helper.padChrome$;

    for (let i = 0; i < 10; ++i) {
      originalAudioTrack = audioTrack;
      expect(originalAudioTrack).to.equal(audioTrack);
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);

      originalVideoTrack = videoTrack;
      expect(originalVideoTrack).to.equal(videoTrack);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);

      chrome$('.audio-btn').click();
      chrome$('.video-btn').click();
      await chrome$.window.ep_webrtc.deactivate();
      await chrome$.window.ep_webrtc.activate();

      // getUserMedia should give us new audio and video Tracks and disable the old one
      expect(originalAudioTrack).to.not.equal(audioTrack);
      expect(originalAudioTrack.readyState).to.equal('ended');
      expect(audioTrack.readyState).to.equal('live');

      expect(originalVideoTrack).to.not.equal(videoTrack);
      expect(originalVideoTrack.readyState).to.equal('ended');
      expect(videoTrack.readyState).to.equal('live');

      // The mute state should be consistent with icon, wherever they land
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);
    }
  };

  // See if we can trip up the state by "deactivating" webrtc, "activating" webrtc, and then
  // clicking mute/video-off right after the interface returns. As of this writing, addInterface is
  // called twice. we'll try to catch it on the first call.
  const testDeactivateActivateClick = async () => {
    const chrome$ = helper.padChrome$;

    for (let i = 0; i < 10; ++i) {
      originalAudioTrack = audioTrack;
      expect(originalAudioTrack).to.equal(audioTrack);
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);

      originalVideoTrack = videoTrack;
      expect(originalVideoTrack).to.equal(videoTrack);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);

      await chrome$.window.ep_webrtc.deactivate();
      const p = chrome$.window.ep_webrtc.activate();
      await helper.waitForPromise(
          () => chrome$ && chrome$('.interface-container').length === 1, 2000);
      chrome$('.audio-btn').click();
      chrome$('.video-btn').click();

      // Give it a moment to settle.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await p;

      // getUserMedia should give us new audio and video Tracks and disable the old one
      expect(originalAudioTrack).to.not.equal(audioTrack);
      expect(originalAudioTrack.readyState).to.equal('ended');
      expect(audioTrack.readyState).to.equal('live');

      expect(originalVideoTrack).to.not.equal(videoTrack);
      expect(originalVideoTrack.readyState).to.equal('ended');
      expect(videoTrack.readyState).to.equal('live');

      // The mute state should be consistent with icon, wherever they land
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);
    }
  };

  // See if we can trip up the state by clicking mute/video-off, "deactivating"/"activating" webrtc,
  // as close to at the same time as we can
  const testClickWhileReactivate = async () => {
    const chrome$ = helper.padChrome$;

    for (let i = 0; i < 10; i++) {
      originalAudioTrack = audioTrack;
      expect(originalAudioTrack).to.equal(audioTrack);
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);

      originalVideoTrack = videoTrack;
      expect(originalVideoTrack).to.equal(videoTrack);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);

      await chrome$.window.ep_webrtc.deactivate();
      const p = chrome$.window.ep_webrtc.activate();
      chrome$('.audio-btn').click();
      chrome$('.video-btn').click();
      await p;

      // getUserMedia should give us new audio and video Tracks and disable the old one
      expect(originalAudioTrack).to.not.equal(audioTrack);
      expect(originalAudioTrack.readyState).to.equal('ended');
      expect(audioTrack.readyState).to.equal('live');

      expect(originalVideoTrack).to.not.equal(videoTrack);
      expect(originalVideoTrack.readyState).to.equal('ended');
      expect(videoTrack.readyState).to.equal('live');

      // The mute state should be consistent with icon, wherever they land
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);
    }
  };

  // See if we can trip up the state by clicking mute/video-off many times at once.
  // We click mute an odd number of times and video-off an even number of times.
  const testManyClicks = async (done) => {
    const chrome$ = helper.padChrome$;

    for (let i = 0; i < 10; ++i) {
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);
      chrome$('.audio-btn').click();
      chrome$('.audio-btn').click();
      chrome$('.audio-btn').click();
      chrome$('.video-btn').click();
      chrome$('.video-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 100)); // wait to make sure it's settled
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled);
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled);
    }
  };

  describe('audio and video enabled on start', function () {
    beforeEach(async function () {
      this.timeout(60000);
      audioTrack = null;
      videoTrack = null;

      await helper.aNewPad({
        padPrefs: {
          rtcEnabled: false,
          audioEnabledOnStart: true,
          videoEnabledOnStart: true,
        },
      });
      const chrome$ = helper.padChrome$;
      installFakeGetUserMedia();
      // Clicking $('#options-enablertc') also activates, but calling activate() directly blocks
      // until activation is complete.
      await chrome$.window.ep_webrtc.activate();
    });

    it('click, deactivate, activate', async function () {
      expect(audioTrack.enabled).to.equal(true);
      expect(videoTrack.enabled).to.equal(true);
      await testClickDeactivateActivate();
    });

    it('deactivate, click, activate', async function () {
      expect(audioTrack.enabled).to.equal(true);
      expect(videoTrack.enabled).to.equal(true);
      await testDeactivateClickActivate();
    });

    it('deactivate, activate, click', async function () {
      expect(audioTrack.enabled).to.equal(true);
      expect(videoTrack.enabled).to.equal(true);
      await testDeactivateActivateClick();
    });

    it('click while reactivate', async function () {
      expect(audioTrack.enabled).to.equal(true);
      expect(videoTrack.enabled).to.equal(true);
      await testClickWhileReactivate();
    });

    it('many clicks', async function () {
      expect(audioTrack.enabled).to.equal(true);
      expect(videoTrack.enabled).to.equal(true);
      await testManyClicks();
    });
  });

  describe('audio and video disabled on start', function () {
    beforeEach(async function () {
      this.timeout(60000);
      audioTrack = null;
      videoTrack = null;

      await helper.aNewPad({
        padPrefs: {
          rtcEnabled: false,
          audioEnabledOnStart: false,
          videoEnabledOnStart: false,
        },
      });
      const chrome$ = helper.padChrome$;
      installFakeGetUserMedia();
      // Clicking $('#options-enablertc') also activates, but calling activate() directly blocks
      // until activation is complete.
      await chrome$.window.ep_webrtc.activate();
    });

    it('click, deactivate, activate', async function () {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false);
      expect(videoTrack.enabled).to.equal(false);
      await testClickDeactivateActivate();
    });

    it('deactivate, click, activate', async function () {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false);
      expect(videoTrack.enabled).to.equal(false);
      await testDeactivateClickActivate();
    });

    it('deactivate, activate, click', async function () {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false);
      expect(videoTrack.enabled).to.equal(false);
      await testDeactivateActivateClick();
    });

    it('click while reactivate', async function () {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false);
      expect(videoTrack.enabled).to.equal(false);
      await testClickWhileReactivate();
    });

    it('many clicks', async function () {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false);
      expect(videoTrack.enabled).to.equal(false);
      await testManyClicks();
    });
  });
});
