'use strict';

const {fakeGetUserMedia} = require('ep_webrtc/static/tests/frontend/utils');

describe('Test the behavior of the interface buttons: Mute, Video Disable, Enlarge', function () {
  let audioTrack;
  let videoTrack;

  const installFakeGetUserMedia = () => {
    const chrome$ = helper.padChrome$;
    chrome$.window.navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await fakeGetUserMedia(constraints);
      audioTrack = stream.getAudioTracks()[0];
      videoTrack = stream.getVideoTracks()[0];
      return stream;
    };
  };

  describe('audio and video on by default', function () {
    beforeEach(async function () {
      this.timeout(60000);
      audioTrack = null;
      videoTrack = null;

      // Make sure webrtc starts disabled so we have time to wrap getUserMedia
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

    it('enlarges then shrinks', async function () {
      const chrome$ = helper.padChrome$;

      this.timeout(60000);

      // i.e., "160.25px" -> 160.25 the number
      const numFromCssSize = (size) => {
        expect(size.slice(-2)).to.be('px');
        return Number(size.slice(0, -2));
      };

      // All of these sizes have to allow for tolerances.
      // I.e. it has come back a quarter pixel off before.
      const $video = chrome$('video');
      await helper.waitForPromise(() => {
        const w = numFromCssSize($video.css('width'));
        const h = numFromCssSize($video.css('height'));
        return 159 < w && w < 161 && 119 < h && h < 121;
      });

      const $enlargeBtn = chrome$('.enlarge-btn');
      $enlargeBtn.click();

      // Expect it to grow to 260, 190
      await helper.waitForPromise(
          () => (numFromCssSize($video.css('width')) > 259 &&
                 numFromCssSize($video.css('height')) > 194),
          1000);
      $enlargeBtn.click();
      // Expect it to shrink to 160, 116
      await helper.waitForPromise(
          () => (numFromCssSize($video.css('width')) < 161 &&
                 numFromCssSize($video.css('height')) < 121),
          1000);
    });

    it('mutes then unmutes', async function () {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(audioTrack.enabled).to.be(true);
      expect(chrome$('.audio-btn.muted').length).to.be(0);
      expect(chrome$('.audio-btn').attr('title')).to.be('Mute');

      const $audioBtn = chrome$('.audio-btn');
      $audioBtn.click();

      await helper.waitForPromise(
          () => chrome$('.audio-btn.muted').length === 1 && audioTrack.enabled === false, 3000);
      expect(chrome$('.audio-btn').attr('title')).to.be('Unmute');
      $audioBtn.click();
      await helper.waitForPromise(
          () => chrome$('.audio-btn.muted').length === 0 && audioTrack.enabled === true, 3000);
      expect(chrome$('.audio-btn').attr('title')).to.be('Mute');
    });

    it('disables then enables video', async function () {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(videoTrack.enabled).to.be(true);
      expect(chrome$('.video-btn.off').length).to.be(0);
      expect(chrome$('.video-btn').attr('title')).to.contain('Disable');

      const $videoBtn = chrome$('.video-btn');
      $videoBtn.click();

      await helper.waitForPromise(
          () => chrome$('.video-btn.off').length === 1 && videoTrack.enabled === false, 3000);
      expect(chrome$('.video-btn').attr('title')).to.contain('Enable');
      $videoBtn.click();
      await helper.waitForPromise(
          () => chrome$('.video-btn.off').length === 0 && videoTrack.enabled === true, 3000);
      expect(chrome$('.video-btn').attr('title')).to.contain('Disable');
    });
  });

  context('audio and video off by default', function () {
    beforeEach(async function () {
      this.timeout(60000);
      audioTrack = null;
      videoTrack = null;

      // Make sure webrtc starts disabled so we have time to wrap getUserMedia
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

    it('unmutes then mutes', async function () {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(audioTrack.enabled).to.be(false);
      expect(chrome$('.audio-btn.muted').length).to.be(1);
      expect(chrome$('.audio-btn').attr('title')).to.be('Unmute');

      const $audioBtn = chrome$('.audio-btn');
      $audioBtn.click();

      await helper.waitForPromise(
          () => chrome$('.audio-btn.muted').length === 0 && audioTrack.enabled === true, 3000);
      expect(chrome$('.audio-btn').attr('title')).to.be('Mute');
      $audioBtn.click();
      await helper.waitForPromise(
          () => chrome$('.audio-btn.muted').length === 1 && audioTrack.enabled === false, 3000);
      expect(chrome$('.audio-btn').attr('title')).to.be('Unmute');
    });

    it('enables then disables video', async function () {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      await helper.waitForPromise(
          () => chrome$('.video-btn').length === 1 && videoTrack != null, 3000);
      expect(videoTrack.enabled).to.be(false);
      expect(chrome$('.video-btn.off').length).to.be(1);
      expect(chrome$('.video-btn').attr('title')).to.contain('Enable');

      const $videoBtn = chrome$('.video-btn');
      $videoBtn.click();

      await helper.waitForPromise(
          () => chrome$('.video-btn.off').length === 0 && videoTrack.enabled === true, 3000);
      expect(chrome$('.video-btn').attr('title')).to.contain('Disable');
      $videoBtn.click();
      await helper.waitForPromise(
          () => chrome$('.video-btn.off').length === 1 && videoTrack.enabled === false, 3000);
      expect(chrome$('.video-btn').attr('title')).to.contain('Enable');
    });
  });

  context('audio and video hard-disabled', function () {
    beforeEach(async function () {
      this.timeout(60000);
      audioTrack = null;
      videoTrack = null;
      // Make sure webrtc starts disabled so we have time to wrap getUserMedia and change settings
      // before activation.
      await helper.aNewPad({params: {av: false}});
      const chrome$ = helper.padChrome$;
      await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
      chrome$.window.ep_webrtc._settings.audio.disabled = 'hard';
      chrome$.window.ep_webrtc._settings.video.disabled = 'hard';
      installFakeGetUserMedia();
      // Clicking $(#options-enablertc) also activates, but calling activate() directly blocks until
      // activation is complete.
      await chrome$.window.ep_webrtc.activate();
    });

    it('cannot mute or unmute', async function () {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(chrome$('.audio-btn.disallowed').length).to.be(1);
      expect(chrome$('.audio-btn.muted').length).to.be(1);
      expect(chrome$('.audio-btn').attr('title')).to.be('Audio disallowed by admin');
      expect(audioTrack).to.be(null);
      expect(videoTrack).to.be(null);

      const $audioBtn = chrome$('.audio-btn');
      $audioBtn.click();

      // Wait a sec to make sure there's no change
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(chrome$('.audio-btn.disallowed').length).to.be(1);
      expect(chrome$('.audio-btn.muted').length).to.be(1);
      expect(chrome$('.audio-btn').attr('title')).to.be('Audio disallowed by admin');
      expect(audioTrack).to.be(null);
      expect(videoTrack).to.be(null);
    });

    it('cannot enable or disable video', async function () {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(chrome$('.video-btn.disallowed').length).to.be(1);
      expect(chrome$('.video-btn.off').length).to.be(1);
      expect(chrome$('.video-btn').attr('title')).to.be('Video disallowed by admin');
      expect(audioTrack).to.be(null);
      expect(videoTrack).to.be(null);

      const $videoBtn = chrome$('.video-btn');
      $videoBtn.click();

      // Wait a sec to make sure there's no change
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(chrome$('.video-btn.disallowed').length).to.be(1);
      expect(chrome$('.video-btn.off').length).to.be(1);
      expect(chrome$('.video-btn').attr('title')).to.be('Video disallowed by admin');
      expect(audioTrack).to.be(null);
      expect(videoTrack).to.be(null);
    });
  });
});
