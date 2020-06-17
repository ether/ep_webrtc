describe('Make sure there are no race conditions that leave audio/video track enabled status and icons in an inconsistent state', function() {
  // The idea here is to place high value on making sure that the "mute" and "video-off" buttons in the video interfaces
  // match with the audioTrack.enabled/videoTrack.enabled, so that users don't get the wrong idea about whether
  // the audio or video feed are on.
  //
  // These tests are various ideas for trying to do things in quick succession or "at the same time". We can add more if we think of them.

  var audioTrack;
  var videoTrack;

  // wrap getUserMedia such that it grabs a copy of audio and video tracks for inspection after it's done
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

  // See if we can trip up the state by "deactivating" webrtc, clicking mute/video-off, and "activating" webrtc in quick succession
  // As of this writing, "deactivating" will make the buttons disappear pretty quickly, making the "click" ineffectual,
  // regardless, but in case we ever change things around, perhaps this test will catch something.
  function testDeactivateClickActivate(done) {
    const chrome$ = helper.padChrome$;

    function loop(i) {
      originalAudioTrack = audioTrack
      expect(originalAudioTrack).to.equal(audioTrack)
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled)

      originalVideoTrack = videoTrack
      expect(originalVideoTrack).to.equal(videoTrack)
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled)

      chrome$.window.ep_webrtc.deactivate()
      chrome$('.audio-btn').click();
      chrome$('.video-btn').click();
      chrome$.window.ep_webrtc.activate().then(function() {
        // getUserMedia should give us new audio and video Tracks and disable the old one
        expect(originalAudioTrack).to.not.equal(audioTrack)
        expect(originalAudioTrack.readyState).to.equal("ended")
        expect(audioTrack.readyState).to.equal("live")

        expect(originalVideoTrack).to.not.equal(videoTrack)
        expect(originalVideoTrack.readyState).to.equal("ended")
        expect(videoTrack.readyState).to.equal("live")

        // The mute state should be consistent with icon, wherever they land
        expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled)
        expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled)
        if (i > 0) {
          return loop(i - 1)
        } else {
          done()
        }
      })
    }
    loop(10)
  }

  // See if we can trip up the state by clicking mute/video-off, "deactivating" webrtc, and "activating" webrtc in quick succession
  function testClickDeactivateActivate(done) {
    const chrome$ = helper.padChrome$;

    function loop(i) {
      originalAudioTrack = audioTrack
      expect(originalAudioTrack).to.equal(audioTrack)
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled)

      originalVideoTrack = videoTrack
      expect(originalVideoTrack).to.equal(videoTrack)
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled)

      chrome$('.audio-btn').click();
      chrome$('.video-btn').click();
      chrome$.window.ep_webrtc.deactivate()
      chrome$.window.ep_webrtc.activate().then(function() {
        // getUserMedia should give us new audio and video Tracks and disable the old one
        expect(originalAudioTrack).to.not.equal(audioTrack)
        expect(originalAudioTrack.readyState).to.equal("ended")
        expect(audioTrack.readyState).to.equal("live")

        expect(originalVideoTrack).to.not.equal(videoTrack)
        expect(originalVideoTrack.readyState).to.equal("ended")
        expect(videoTrack.readyState).to.equal("live")

        // The mute state should be consistent with icon, wherever they land
        expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled)
        expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled)
        if (i > 0) {
          return loop(i - 1)
        } else {
          done()
        }
      })
    }
    loop(10)
  }

  // See if we can trip up the state by "deactivating" webrtc, "activating" webrtc, and then clicking mute/video-off
  // right after the interface returns. As of this writing, addInterface is called twice. we'll try to catch it on
  // the first call.
  function testDeactivateActivateClick(done) {
    const chrome$ = helper.padChrome$;

    function loop(i) {
      originalAudioTrack = audioTrack
      expect(originalAudioTrack).to.equal(audioTrack)
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled)

      originalVideoTrack = videoTrack
      expect(originalVideoTrack).to.equal(videoTrack)
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled)

      chrome$.window.ep_webrtc.deactivate()
      chrome$.window.ep_webrtc.activate()

      helper.waitFor(function(){
        return chrome$ && chrome$(".interface-container").length === 1;
      }, 2000).done(function () {
        chrome$('.audio-btn').click();
        chrome$('.video-btn').click();

        // Give it a moment to settle.
        setTimeout(function() { // wait to make sure it's settled
          // getUserMedia should give us new audio and video Tracks and disable the old one
          expect(originalAudioTrack).to.not.equal(audioTrack)
          expect(originalAudioTrack.readyState).to.equal("ended")
          expect(audioTrack.readyState).to.equal("live")

          expect(originalVideoTrack).to.not.equal(videoTrack)
          expect(originalVideoTrack.readyState).to.equal("ended")
          expect(videoTrack.readyState).to.equal("live")

          // The mute state should be consistent with icon, wherever they land
          expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled)
          expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled)
          if (i > 0) {
            return loop(i - 1)
          } else {
            done()
          }
        }, 200)
      })
    }
    loop(10)
  }

  // See if we can trip up the state by clicking mute/video-off, "deactivating"/"activating" webrtc, as close to at the
  // same time as we can (using Promise.all)
  function testClickWhileReactivate(done) {
    const chrome$ = helper.padChrome$;

    function loop(i) {
      originalAudioTrack = audioTrack
      expect(originalAudioTrack).to.equal(audioTrack)
      expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled)

      originalVideoTrack = videoTrack
      expect(originalVideoTrack).to.equal(videoTrack)
      expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled)

      Promise.all([
        new Promise(function(resolve) {
          chrome$.window.ep_webrtc.deactivate()
          return chrome$.window.ep_webrtc.activate().then(resolve)
        }),
        new Promise(function(resolve) {
          chrome$('.audio-btn').click();
          chrome$('.video-btn').click();
          resolve()
        })
      ]).then(function() {
        // getUserMedia should give us new audio and video Tracks and disable the old one
        expect(originalAudioTrack).to.not.equal(audioTrack)
        expect(originalAudioTrack.readyState).to.equal("ended")
        expect(audioTrack.readyState).to.equal("live")

        expect(originalVideoTrack).to.not.equal(videoTrack)
        expect(originalVideoTrack.readyState).to.equal("ended")
        expect(videoTrack.readyState).to.equal("live")

        // The mute state should be consistent with icon, wherever they land
        expect(chrome$('.audio-btn').hasClass('muted')).to.equal(!audioTrack.enabled)
        expect(chrome$('.video-btn').hasClass('off')).to.equal(!videoTrack.enabled)
        if (i > 0) {
          loop(i - 1)
        } else {
          done()
        }
      })
    }
    loop(10)
  }

  // See if we can trip up the state by clicking mute/video-off many times at once.
  // We click mute an odd number of times and video-off an even number of times.
  function testManyClicks(done) {
    var chrome$ = helper.padChrome$;

    function loop(i) {
      expect(chrome$('.audio-btn').hasClass('muted'))
        .to.equal(!audioTrack.enabled)
      expect(chrome$('.video-btn').hasClass('off'))
        .to.equal(!videoTrack.enabled)
      Promise.all([
        new Promise(function(resolve) {chrome$('.audio-btn').click(); resolve()}),
        new Promise(function(resolve) {chrome$('.audio-btn').click(); resolve()}),
        new Promise(function(resolve) {chrome$('.audio-btn').click(); resolve()}),
        new Promise(function(resolve) {chrome$('.video-btn').click(); resolve()}),
        new Promise(function(resolve) {chrome$('.video-btn').click(); resolve()})
      ]).then(function() {
        setTimeout(function() { // wait to make sure it's settled
          expect(chrome$('.audio-btn').hasClass('muted'))
            .to.equal(!audioTrack.enabled)
          expect(chrome$('.video-btn').hasClass('off'))
            .to.equal(!videoTrack.enabled)
          if (i > 0) {
            loop(i - 1)
          } else {
            done()
          }
        }, 100)
      })
    }

    loop(10)
  }

  context('audio and video enabled on start', function() {

    beforeEach(function (done) {
      audioTrack = null;
      videoTrack = null;

      helper.newPad({
        padPrefs: {
          rtcEnabled: false,
          fakeWebrtcFirefox: true,
          audioEnabledOnStart: true,
          videoEnabledOnStart: true
        },
        cb: function () {
          const chrome$ = helper.padChrome$;

          helper.waitFor(function(){
            return chrome$ && chrome$("#options-enablertc").length === 1;
          }, 2000).done(function () {
            wrapGetUserMedia();

            var $enableRtc = chrome$("#options-enablertc");
            $enableRtc.click(); // Turn it on late so that wrapGetUserMedia works

            helper.waitFor(function(){
                return (
                  chrome$(".audio-btn").length === 1 &&
                  chrome$(".video-btn").length === 1 &&
                  audioTrack !== null &&
                  videoTrack !== null
                )
              }, 1000).done(function () {
                // Video interface buttons are added twice, and there's no good way besides a timeout to tell when it's done
                // being called the second time. We want it to be finished so our test is stable.
                setTimeout(done, 200)
              });

          });
        }
      })
      this.timeout(60000);
    });

    it('keeps audio track enabled and mute/video icons consistent when clicking, then deactivating, then activating', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(true)
      expect(videoTrack.enabled).to.equal(true)
      testClickDeactivateActivate(done);
    })

    it('keeps audio track enabled and mute/video icons consistent when deactivating, then clicking, then activating', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(true)
      expect(videoTrack.enabled).to.equal(true)
      testDeactivateClickActivate(done);
    })

    it('keeps audio track enabled and mute/video icons consistent when deactivating, then activating, then clicking', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(true)
      expect(videoTrack.enabled).to.equal(true)
      testDeactivateActivateClick(done);
    })

    it('keeps audio track enabled and mute/video icons consistent when clicking while deactivating then activating', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(true)
      expect(videoTrack.enabled).to.equal(true)
      testClickWhileReactivate(done);
    })

    it('keeps audio track enabled and mute/video icons consistent when rapidly clicking mute/video-off', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(true)
      expect(videoTrack.enabled).to.equal(true)
      testManyClicks(done);
    });

  });

  context('audio and video disabled on start', function() {

    beforeEach(function (done) {
      audioTrack = null;
      videoTrack = null;

      helper.newPad({
        padPrefs: {
          rtcEnabled: false,
          fakeWebrtcFirefox: true,
          audioEnabledOnStart: false,
          videoEnabledOnStart: false
        },
        cb: function () {
          const chrome$ = helper.padChrome$;

          helper.waitFor(function(){
            return chrome$ && chrome$("#options-enablertc").length === 1;
          }, 2000).done(function () {
            wrapGetUserMedia();

            var $enableRtc = chrome$("#options-enablertc");
            $enableRtc.click(); // Turn it on late so that wrapGetUserMedia works

            helper.waitFor(function(){
                return (
                  chrome$(".audio-btn").length === 1 &&
                  chrome$(".video-btn").length === 1 &&
                  audioTrack !== null &&
                  videoTrack !== null
                )
              }, 1000).done(function () {
                // Video interface buttons are added twice, and there's no good way besides a timeout to tell when it's done
                // being called the second time. We want it to be finished so our test is stable.
                setTimeout(done, 200)
              });

          });
        }
      })
      this.timeout(60000);
    });

    it('keeps audio track enabled and mute/video icons consistent when clicking, then deactivating, then activating', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false)
      expect(videoTrack.enabled).to.equal(false)
      testClickDeactivateActivate(done);
    })

    it('keeps audio track enabled and mute/video icons consistent when deactivating, then clicking, then activating', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false)
      expect(videoTrack.enabled).to.equal(false)
      testDeactivateClickActivate(done);
    })

    it('keeps audio track enabled and mute/video icons consistent when deactivating, then activating, then clicking', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false)
      expect(videoTrack.enabled).to.equal(false)
      testDeactivateActivateClick(done);
    })

    it('keeps audio track enabled and mute/video icons consistent when clicking while deactivating then activating', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false)
      expect(videoTrack.enabled).to.equal(false)
      testClickWhileReactivate(done);
    })

    it('keeps audio track enabled and mute/video icons consistent when rapidly clicking mute/video-off', function(done) {
      this.timeout(5000);
      expect(audioTrack.enabled).to.equal(false)
      expect(videoTrack.enabled).to.equal(false)
      testManyClicks(done);
    });

  });

});
