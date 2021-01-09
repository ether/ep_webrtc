/* eslint max-len: ["error", { "code": 120 }] */
'use strict';

describe('Test the behavior of the interface buttons: Mute, Video Disable, Enlarge', function () {
  let audioTrack;
  let videoTrack;

  function wrapGetUserMedia() {
    const chrome$ = helper.padChrome$;
    const oldGetUserMedia = chrome$.window.navigator.mediaDevices.getUserMedia;
    chrome$.window.navigator.mediaDevices.getUserMedia = function (mediaConstraints) {
      return oldGetUserMedia.call(chrome$.window.navigator.mediaDevices, mediaConstraints)
          .then((stream) => {
            audioTrack = stream.getAudioTracks()[0];
            videoTrack = stream.getVideoTracks()[0];
            return stream;
          });
    };
  }

  context('audio and video on by default', function () {
    beforeEach(function (done) {
      audioTrack = null;
      videoTrack = null;

      // Make sure webrtc starts disabled so we have time to wrap getUserMedia
      helper.newPad({
        padPrefs: {
          rtcEnabled: false,
          fakeWebrtcFirefox: true,
          audioEnabledOnStart: true,
          videoEnabledOnStart: true,
        },
        cb() {
          const chrome$ = helper.padChrome$;

          helper.waitFor(() => chrome$ &&
              chrome$('#options-enablertc').length === 1, 2000).done(() => {
            wrapGetUserMedia();

            const $enableRtc = chrome$('#options-enablertc');
            $enableRtc.click(); // Turn it on late so that wrapGetUserMedia works

            helper.waitFor(() => (
              chrome$('.audio-btn').length === 1 &&
                chrome$('.video-btn').length === 1 &&
                audioTrack != null &&
                videoTrack != null
            ), 1000).done(() => {
              // Video interface buttons are added twice, and there's no good
              // way besides a timeout to tell when it's done
              // being called the second time. We want it to be finished so our test is stable.
              setTimeout(done, 200);
            });
          });
        },
      });
      this.timeout(60000);
    });

    it('enlarges then shrinks', function (done) {
      const chrome$ = helper.padChrome$;

      this.timeout(60000);

      expect(chrome$('video').css('width')).to.be('160px');
      expect(chrome$('video').css('height')).to.be('116px');

      const $enlargeBtn = chrome$('.enlarge-btn');
      $enlargeBtn.click();

      helper.waitFor(() => chrome$('video').css('width') === '260px' &&
               chrome$('video').css('height') === '191px', 1000).done(() => {
        $enlargeBtn.click();
        helper.waitFor(() => chrome$('video').css('width') === '160px' &&
                 chrome$('video').css('height') === '116px', 1000).done(() => {
          done();
        });
      });
    });

    it('mutes then unmutes', function (done) {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(audioTrack.enabled).to.be(true);
      expect(chrome$('.audio-btn.muted').length).to.be(0);
      expect(chrome$('.audio-btn').attr('title')).to.be('Mute');

      const $audioBtn = chrome$('.audio-btn');
      $audioBtn.click();

      helper.waitFor(() => chrome$('.audio-btn.muted').length === 1 && audioTrack.enabled === false, 3000).done(() => {
        expect(chrome$('.audio-btn').attr('title')).to.be('Unmute');
        $audioBtn.click();
        helper.waitFor(() => chrome$('.audio-btn.muted').length === 0 && audioTrack.enabled === true, 3000).done(() => {
          expect(chrome$('.audio-btn').attr('title')).to.be('Mute');
          done();
        });
      });
    });

    it('disables then enables video', function (done) {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(videoTrack.enabled).to.be(true);
      expect(chrome$('.video-btn.off').length).to.be(0);
      expect(chrome$('.video-btn').attr('title')).to.contain('Disable');

      const $videoBtn = chrome$('.video-btn');
      $videoBtn.click();

      helper.waitFor(() => chrome$('.video-btn.off').length === 1 && videoTrack.enabled === false, 3000).done(() => {
        expect(chrome$('.video-btn').attr('title')).to.contain('Enable');
        $videoBtn.click();
        helper.waitFor(() => chrome$('.video-btn.off').length === 0 && videoTrack.enabled === true, 3000).done(() => {
          expect(chrome$('.video-btn').attr('title')).to.contain('Disable');
          done();
        });
      });
    });
  });

  context('audio and video off by default', function () {
    beforeEach(function (done) {
      audioTrack = null;
      videoTrack = null;

      // Make sure webrtc starts disabled so we have time to wrap getUserMedia
      helper.newPad({
        padPrefs: {
          rtcEnabled: false,
          fakeWebrtcFirefox: true,
          audioEnabledOnStart: false,
          videoEnabledOnStart: false,
        },
        cb() {
          const chrome$ = helper.padChrome$;

          helper.waitFor(() => chrome$ && chrome$('#options-enablertc').length === 1, 2000).done(() => {
            wrapGetUserMedia();
            const $enableRtc = chrome$('#options-enablertc');
            $enableRtc.click(); // Turn it on late so that wrapGetUserMedia works

            helper.waitFor(() => (
              chrome$('.audio-btn').length === 1 &&
                chrome$('.video-btn').length === 1 &&
                audioTrack != null &&
                videoTrack != null
            ), 1000).done(() => {
              // Video interface buttons are added twice,
              // and there's no good way besides a timeout to tell when it's done
              // being called the second time. We want it to be finished so our test is stable.
              setTimeout(done, 200);
            });
          });
        },
      });
      this.timeout(60000);
    });

    it('unmutes then mutes', function (done) {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(audioTrack.enabled).to.be(false);
      expect(chrome$('.audio-btn.muted').length).to.be(1);
      expect(chrome$('.audio-btn').attr('title')).to.be('Unmute');

      const $audioBtn = chrome$('.audio-btn');
      $audioBtn.click();

      helper.waitFor(() => chrome$('.audio-btn.muted').length === 0 &&
          audioTrack.enabled === true, 3000).done(() => {
        expect(chrome$('.audio-btn').attr('title')).to.be('Mute');
        $audioBtn.click();
        helper.waitFor(() => chrome$('.audio-btn.muted').length === 1 &&
            audioTrack.enabled === false, 3000).done(() => {
          expect(chrome$('.audio-btn').attr('title')).to.be('Unmute');
          done();
        });
      });
    });

    it('enables then disables video', function (done) {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      helper.waitFor(() => chrome$('.video-btn').length === 1 && videoTrack != null, 3000).done(() => {
        expect(videoTrack.enabled).to.be(false);
        expect(chrome$('.video-btn.off').length).to.be(1);
        expect(chrome$('.video-btn').attr('title')).to.contain('Enable');

        const $videoBtn = chrome$('.video-btn');
        $videoBtn.click();

        helper.waitFor(() => chrome$('.video-btn.off').length === 0 && videoTrack.enabled === true, 3000).done(() => {
          expect(chrome$('.video-btn').attr('title')).to.contain('Disable');
          $videoBtn.click();
          helper.waitFor(() => chrome$('.video-btn.off').length === 1 &&
              videoTrack.enabled === false, 3000).done(() => {
            expect(chrome$('.video-btn').attr('title')).to.contain('Enable');
            done();
          });
        });
      });
    });
  });

  context('audio and video hard-disabled', function () {
    beforeEach(function (done) {
      audioTrack = null;
      videoTrack = null;

      // Make sure webrtc starts disabled so we have time to wrap getUserMedia
      helper.newPad({
        padPrefs: {
          rtcEnabled: true,
          fakeWebrtcFirefox: true,
        },
        cb() {
          const chrome$ = helper.padChrome$;
          chrome$.window.clientVars.webrtc.audio.disabled = 'hard';
          chrome$.window.clientVars.webrtc.video.disabled = 'hard';

          helper.waitFor(() => (
            chrome$('.audio-btn').length === 1 &&
              chrome$('.video-btn').length === 1
          ), 1000).done(() => {
            wrapGetUserMedia();
            // Video interface buttons are added twice, and there's no good way besides a timeout to tell when it's done
            // being called the second time. We want it to be finished so our test is stable.
            setTimeout(done, 200);
          });
        },
      });
      this.timeout(60000);
    });

    it('cannot mute or unmute', function (done) {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(chrome$('.audio-btn.disallowed').length).to.be(1);
      expect(chrome$('.audio-btn.muted').length).to.be(1);
      expect(chrome$('.audio-btn').attr('title')).to.be('Audio disallowed by admin');
      expect(audioTrack).to.be(null);
      expect(videoTrack).to.be(null);

      const $audioBtn = chrome$('.audio-btn');
      $audioBtn.click();

      setTimeout(() => {
        // Wait a sec to make sure there's no change
        expect(chrome$('.audio-btn.disallowed').length).to.be(1);
        expect(chrome$('.audio-btn.muted').length).to.be(1);
        expect(chrome$('.audio-btn').attr('title')).to.be('Audio disallowed by admin');
        expect(audioTrack).to.be(null);
        expect(videoTrack).to.be(null);
        done();
      }, 200);
    });

    it('cannot enable or disable video', function (done) {
      this.timeout(60000);

      const chrome$ = helper.padChrome$;

      expect(chrome$('.video-btn.disallowed').length).to.be(1);
      expect(chrome$('.video-btn.off').length).to.be(1);
      expect(chrome$('.video-btn').attr('title')).to.be('Video disallowed by admin');
      expect(audioTrack).to.be(null);
      expect(videoTrack).to.be(null);

      const $videoBtn = chrome$('.video-btn');
      $videoBtn.click();

      setTimeout(() => {
        // Wait a sec to make sure there's no change
        expect(chrome$('.video-btn.disallowed').length).to.be(1);
        expect(chrome$('.video-btn.off').length).to.be(1);
        expect(chrome$('.video-btn').attr('title')).to.be('Video disallowed by admin');
        expect(audioTrack).to.be(null);
        expect(videoTrack).to.be(null);
        done();
      }, 200);
    });
  });
});
