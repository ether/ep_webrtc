// TODO do getUserMedia trick to all of these to remove the firefox fake cookie - ? Requires the rtcEnabled start as off tho. Won't work so well. Maybe that'll be okay tho.

describe('enable and disable audio/video tracks in UI', function() {
  beforeEach(function(done) {
    // Make sure webrtc is enabled, and reload with the firefox fake webrtc pref
    // (Chrome needs a CLI parameter to have fake webrtc)
    helper.newPad({
      clearCookies: false,
      padPrefs: {rtcEnabled: false, fakeWebrtcFirefox: true},
      cb: done
    });
    this.timeout(60000);
  });

  function wrapGetUserMedia(inner) {
    const chrome$ = helper.padChrome$;
    const oldGetUserMedia = chrome$.window.navigator.mediaDevices.getUserMedia
    chrome$.window.navigator.mediaDevices.getUserMedia = function(mediaConstraints) {
      return oldGetUserMedia.call(chrome$.window.navigator.mediaDevices, mediaConstraints)
      .then(function(stream) {
        return inner(stream)
      });
    };
  }

  // TODO - unmute then mute, once we add mute cookies
  it('mutes then unmutes', function(done) {
    this.timeout(10000);

    var chrome$ = helper.padChrome$;
    var audioTrack;

    wrapGetUserMedia(function (stream) {
      audioTrack = stream.getAudioTracks()[0]
      return stream
    })

    var $enableRtc = chrome$("#options-enablertc");
    $enableRtc.click();

    helper.waitFor(function(){
      return chrome$(".audio-btn").length === 1 && audioTrack !== undefined && audioTrack.enabled === true;
    }, 5000).done(function () {
      expect(chrome$(".audio-btn.muted").length).to.be(0);
      expect(chrome$(".audio-btn").attr("title")).to.be("Mute");

      var $audioBtn = chrome$(".audio-btn");
      $audioBtn.click()

      helper.waitFor(function(){
        return chrome$(".audio-btn.muted").length === 1 && audioTrack.enabled === false;
      }, 1000).done(function () {
        expect(chrome$(".audio-btn").attr("title")).to.be("Unmute");
        $audioBtn.click()
        helper.waitFor(function(){
          return chrome$(".audio-btn.muted").length === 0 && audioTrack.enabled === true;
        }, 1000).done(function () {
          expect(chrome$(".audio-btn").attr("title")).to.be("Mute");
          done()
        })
      })
    });
  });

  // TODO - disable then enable, once we add video enable cookies
  it('disables then enables video', function(done) {
    this.timeout(10000);

    var chrome$ = helper.padChrome$;
    var videoTrack;

    wrapGetUserMedia(function (stream) {
      videoTrack = stream.getVideoTracks()[0]
      return stream
    })

    var $enableRtc = chrome$("#options-enablertc");
    $enableRtc.click();

    helper.waitFor(function(){
      return chrome$(".video-btn").length === 1 && videoTrack !== undefined && videoTrack.enabled === true;
    }, 5000).done(function () {
      expect(chrome$(".video-btn.off").length).to.be(0);
      expect(chrome$(".video-btn").attr("title")).to.contain("Disable");

      var $videoBtn = chrome$(".video-btn");
      $videoBtn.click()

      helper.waitFor(function(){
        return chrome$(".video-btn.off").length === 1 && videoTrack.enabled === false;
      }, 1000).done(function () {
        expect(chrome$(".video-btn").attr("title")).to.contain("Enable");
        $videoBtn.click()
        helper.waitFor(function(){
          return chrome$(".video-btn.off").length === 0 && videoTrack.enabled === true;
        }, 1000).done(function () {
          expect(chrome$(".video-btn").attr("title")).to.contain("Disable");
          done()
        })
      })
    });
  });

});
