'use strict';

describe('Test the behavior of the interface buttons: Mute, Video Disable, Enlarge', function () {
  let audioTrack;
  let videoTrack;

  const wrapGetUserMedia = () => {
    const chrome$ = helper.padChrome$;
    const oldGetUserMedia = chrome$.window.navigator.mediaDevices.getUserMedia;
    chrome$.window.navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await oldGetUserMedia.call(chrome$.window.navigator.mediaDevices, constraints);
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
          fakeWebrtcFirefox: true,
          audioEnabledOnStart: true,
          videoEnabledOnStart: true,
        },
      });
      const chrome$ = helper.padChrome$;

      await helper.waitForPromise(
          () => chrome$ && chrome$('#options-enablertc').length === 1, 2000);
      wrapGetUserMedia();

      const $enableRtc = chrome$('#options-enablertc');
      $enableRtc.click(); // Turn it on late so that wrapGetUserMedia works

      await helper.waitForPromise(
          () => (chrome$('.audio-btn').length === 1 && chrome$('.video-btn').length === 1 &&
                 audioTrack != null && videoTrack != null),
          1000);
      // Video interface buttons are added twice, and there's no good way besides a timeout to tell
      // when it's done being called the second time. We want it to be finished so our test is
      // stable.
      await new Promise((resolve) => setTimeout(resolve, 200));
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
      expect(numFromCssSize($video.css('width'))).to.be.within(159, 161);
      expect(numFromCssSize($video.css('height'))).to.be.within(115, 117);

      const $enlargeBtn = chrome$('.enlarge-btn');
      $enlargeBtn.click();

      // Expect it to grow to 260, 190
      await helper.waitForPromise(
          () => (numFromCssSize($video.css('width')) > 259 &&
                 numFromCssSize($video.css('height')) > 190),
          1000);
      $enlargeBtn.click();
      // Expect it to shrink to 160, 116
      await helper.waitForPromise(
          () => (numFromCssSize($video.css('width')) < 161 &&
                 numFromCssSize($video.css('height')) < 117),
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
          fakeWebrtcFirefox: true,
          audioEnabledOnStart: false,
          videoEnabledOnStart: false,
        },
      });
      const chrome$ = helper.padChrome$;

      await helper.waitForPromise(
          () => chrome$ && chrome$('#options-enablertc').length === 1, 2000);
      wrapGetUserMedia();
      const $enableRtc = chrome$('#options-enablertc');
      $enableRtc.click(); // Turn it on late so that wrapGetUserMedia works

      await helper.waitForPromise(
          () => (chrome$('.audio-btn').length === 1 && chrome$('.video-btn').length === 1 &&
                 audioTrack != null && videoTrack != null),
          1000);
      // Video interface buttons are added twice, and there's no good way besides a timeout to tell
      // when it's done being called the second time. We want it to be finished so our test is
      // stable.
      await new Promise((resolve) => setTimeout(resolve, 200));
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
      // Make sure webrtc starts disabled so we have time to wrap getUserMedia
      await helper.aNewPad({
        padPrefs: {
          fakeWebrtcFirefox: true,
        },
        // Disable WebRTC so we can change clientVars before activation.
        params: {av: false},
      });
      const chrome$ = helper.padChrome$;
      chrome$.window.clientVars.webrtc.audio.disabled = 'hard';
      chrome$.window.clientVars.webrtc.video.disabled = 'hard';
      chrome$('#options-enablertc').click();
      await helper.waitForPromise(
          () => (chrome$('.audio-btn').length === 1 && chrome$('.video-btn').length === 1), 1000);
      wrapGetUserMedia();
      // Video interface buttons are added twice, and there's no good way besides a timeout to tell
      // when it's done being called the second time. We want it to be finished so our test is
      // stable.
      await new Promise((resolve) => setTimeout(resolve, 200));
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
