describe('enable and disable audio/video tracks in UI', function() {

  var audioTrack;
  var videoTrack;

  function wrapGetUserMedia() {
    const chrome$ = helper.padChrome$;
    const oldGetUserMedia = chrome$.window.navigator.mediaDevices.getUserMedia;
    chrome$.window.navigator.mediaDevices.getUserMedia = function(mediaConstraints) {
      return oldGetUserMedia.call(chrome$.window.navigator.mediaDevices, mediaConstraints)
      .then(function(stream) {
        audioTrack = stream.getAudioTracks()[0];
        videoTrack = stream.getVideoTracks()[0];
        return stream;
      });
    };
  }

  context('audio and video on by default', function() {
    beforeEach(function(done) {
      audioTrack = null;
      videoTrack = null;

      // Make sure webrtc starts disabled so we have time to wrap getUserMedia
      helper.newPad({
        padPrefs: {
          rtcEnabled: false,
          fakeWebrtcFirefox: true,
          audioEnabledOnStart: true,
          videoEnabledOnStart: true
        },
        cb: function () {wrapGetUserMedia(); done();}
      });
      this.timeout(60000);
    });

    it('mutes then unmutes', function(done) {
      this.timeout(60000);

      var chrome$ = helper.padChrome$;

      var $enableRtc = chrome$("#options-enablertc");
      $enableRtc.click();

      helper.waitFor(function(){
        return chrome$(".audio-btn").length === 1 && audioTrack !== null;
      }, 3000).done(function () {
        expect(audioTrack.enabled).to.be(true);
        expect(chrome$(".audio-btn.muted").length).to.be(0);
        expect(chrome$(".audio-btn").attr("title")).to.be("Mute");

        var $audioBtn = chrome$(".audio-btn");
        $audioBtn.click();

        helper.waitFor(function(){
          return chrome$(".audio-btn.muted").length === 1 && audioTrack.enabled === false;
        }, 3000).done(function () {
          expect(chrome$(".audio-btn").attr("title")).to.be("Unmute");
          $audioBtn.click();
          helper.waitFor(function(){
            return chrome$(".audio-btn.muted").length === 0 && audioTrack.enabled === true;
          }, 3000).done(function () {
            expect(chrome$(".audio-btn").attr("title")).to.be("Mute");
            done();
          });
        });
      });
    });

    it('disables then enables video', function(done) {
      this.timeout(60000);

      var chrome$ = helper.padChrome$;

      var $enableRtc = chrome$("#options-enablertc");
      $enableRtc.click();

      helper.waitFor(function(){
        return chrome$(".video-btn").length === 1 && videoTrack !== null;
      }, 3000).done(function () {
        expect(videoTrack.enabled).to.be(true);
        expect(chrome$(".video-btn.off").length).to.be(0);
        expect(chrome$(".video-btn").attr("title")).to.contain("Disable");

        var $videoBtn = chrome$(".video-btn");
        $videoBtn.click();

        helper.waitFor(function(){
          return chrome$(".video-btn.off").length === 1 && videoTrack.enabled === false;
        }, 3000).done(function () {
          expect(chrome$(".video-btn").attr("title")).to.contain("Enable");
          $videoBtn.click();
          helper.waitFor(function(){
            return chrome$(".video-btn.off").length === 0 && videoTrack.enabled === true;
          }, 3000).done(function () {
            expect(chrome$(".video-btn").attr("title")).to.contain("Disable");
            done();
          });
        });
      });
    });
  });

  context('audio and video off by default', function() {
    beforeEach(function(done) {
      audioTrack = null;
      videoTrack = null;

      // Make sure webrtc starts disabled so we have time to wrap getUserMedia
      helper.newPad({
        padPrefs: {
          rtcEnabled: false,
          fakeWebrtcFirefox: true,
          audioEnabledOnStart: false,
          videoEnabledOnStart: false
        },
        cb: function () {wrapGetUserMedia(); done();}
      });
      this.timeout(60000);
    });

    it('unmutes then mutes', function(done) {
      this.timeout(60000);

      var chrome$ = helper.padChrome$;

      var $enableRtc = chrome$("#options-enablertc");
      $enableRtc.click();

      helper.waitFor(function(){
        return chrome$(".audio-btn").length === 1 && audioTrack !== null;
      }, 3000).done(function () {
        expect(audioTrack.enabled).to.be(false);
        expect(chrome$(".audio-btn.muted").length).to.be(1);
        expect(chrome$(".audio-btn").attr("title")).to.be("Unmute");

        var $audioBtn = chrome$(".audio-btn");
        $audioBtn.click();

        helper.waitFor(function(){
          return chrome$(".audio-btn.muted").length === 0 && audioTrack.enabled === true;
        }, 3000).done(function () {
          expect(chrome$(".audio-btn").attr("title")).to.be("Mute");
          $audioBtn.click();
          helper.waitFor(function(){
            return chrome$(".audio-btn.muted").length === 1 && audioTrack.enabled === false;
          }, 3000).done(function () {
            expect(chrome$(".audio-btn").attr("title")).to.be("Unmute");
            done();
          });
        });
      });
    });

    it('enables then disables video', function(done) {
      this.timeout(60000);

      var chrome$ = helper.padChrome$;

      var $enableRtc = chrome$("#options-enablertc");
      $enableRtc.click();

      helper.waitFor(function(){
        return chrome$(".video-btn").length === 1 && videoTrack !== null;
      }, 3000).done(function () {
        expect(videoTrack.enabled).to.be(false);
        expect(chrome$(".video-btn.off").length).to.be(1);
        expect(chrome$(".video-btn").attr("title")).to.contain("Enable");

        var $videoBtn = chrome$(".video-btn");
        $videoBtn.click();

        helper.waitFor(function(){
          return chrome$(".video-btn.off").length === 0 && videoTrack.enabled === true;
        }, 3000).done(function () {
          expect(chrome$(".video-btn").attr("title")).to.contain("Disable");
          $videoBtn.click();
          helper.waitFor(function(){
            return chrome$(".video-btn.off").length === 1 && videoTrack.enabled === false;
          }, 3000).done(function () {
            expect(chrome$(".video-btn").attr("title")).to.contain("Enable");
            done();
          });
        });
      });
    });
  });
});
