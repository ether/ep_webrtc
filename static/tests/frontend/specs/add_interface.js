function fakeStream(params) {
  return {
    getAudioTracks: function() {return [{enabled: params.audio}]},
    getVideoTracks: function() {return [{enabled: params.video}]}
  }
}

describe('test the addInterface function, which creates of the various video interface buttons, under various conditions', function() {

  const otherUserId = "other_user_id"
  const otherVideoId = "video_other_user_id"
  const otherInterfaceId = "interface_video_other_user_id"
  var ownUserId, ownVideoId, ownInterfaceId

  before(function(done) {
    this.timeout(60000);
    helper.newPad({
      padPrefs: {rtcEnabled: true, fakeWebrtcFirefox: true},
      cb: function () {
        var chrome$
        helper.waitFor(function(){
          chrome$ = helper.padChrome$;
          return chrome$ && chrome$(".interface-container").length === 1;
        }, 1000).done(function () {
          ownUserId = chrome$.window.ep_webrtc.getUserId()
          ownVideoId = "video_" + ownUserId.replace(".", "_")
          ownInterfaceId = "interface_" + ownVideoId

          // Make a fake friend that is being talked with
          $("<video playsinline>")
          .attr("id", otherVideoId)
          .appendTo(
            $("<div class='video-container'>")
              .appendTo(chrome$("#rtcbox"))
          )
          // Video interface buttons are added twice, and there's no good way besides a timeout to tell when it's done
          // being called the second time. We want it to be finished so our test is stable.
          setTimeout(done, 100) 
        });
      }
    });
  });
  context('Audio and Video not hard disabled in clientVars', function() {
    beforeEach(function(done) {
      var chrome$ = helper.padChrome$;
      chrome$('.interface-container').remove()
      helper.waitFor(function(){
        return chrome$(".interface-container").length === 0;
      }, 1000).done(done)
    });

    it('generates local and remote interfaces with all audio and video tracks enabled', function(done) {
      var chrome$ = helper.padChrome$;

      chrome$.window.ep_webrtc.addInterface(ownUserId, fakeStream({audio: true, video: true}))
      chrome$.window.ep_webrtc.addInterface(otherUserId, fakeStream({audio: true, video: true}))

      expect(chrome$(".interface-container").length).to.equal(2)

      expect(chrome$('#' + ownInterfaceId + ' .audio-btn').length).to.equal(1)
      expect(chrome$('#' + ownInterfaceId + ' .audio-btn').hasClass('muted')).to.equal(false)
      expect(chrome$('#' + ownInterfaceId + ' .video-btn').length).to.equal(1)
      expect(chrome$('#' + ownInterfaceId + ' .video-btn').hasClass('off')).to.equal(false)
      expect(chrome$('#' + ownInterfaceId + ' .enlarge-btn').length).to.equal(1)

      expect(chrome$('#' + otherInterfaceId + ' .audio-btn').hasClass('muted')).to.equal(false)
      expect(chrome$('#' + otherInterfaceId + ' .enlarge-btn').length).to.equal(1)
      done()
    });

    it('generates local and remote interfaces with video tracks disabled', function(done) {
      var chrome$ = helper.padChrome$;

      chrome$.window.ep_webrtc.addInterface(ownUserId, fakeStream({audio: true, video: false}))
      chrome$.window.ep_webrtc.addInterface(otherUserId, fakeStream({audio: true, video: false}))

      expect(chrome$(".interface-container").length).to.equal(2)

      expect(chrome$('#' + ownInterfaceId + ' .audio-btn').length).to.equal(1)
      expect(chrome$('#' + ownInterfaceId + ' .audio-btn').hasClass('muted')).to.equal(false)
      expect(chrome$('#' + ownInterfaceId + ' .video-btn').length).to.equal(1)
      expect(chrome$('#' + ownInterfaceId + ' .video-btn').hasClass('off')).to.equal(true)
      expect(chrome$('#' + ownInterfaceId + ' .enlarge-btn').length).to.equal(1)

      expect(chrome$('#' + otherInterfaceId + ' .audio-btn').hasClass('muted')).to.equal(false)
      expect(chrome$('#' + otherInterfaceId + ' .enlarge-btn').length).to.equal(1)
      done()
    });

    it('generates local and remote interfaces with audio tracks disabled', function(done) {
      var chrome$ = helper.padChrome$;

      chrome$.window.ep_webrtc.addInterface(ownUserId, fakeStream({audio: false, video: true}))
      chrome$.window.ep_webrtc.addInterface(otherUserId, fakeStream({audio: false, video: true}))

      expect(chrome$(".interface-container").length).to.equal(2)

      expect(chrome$('#' + ownInterfaceId + ' .audio-btn').length).to.equal(1)
      expect(chrome$('#' + ownInterfaceId + ' .audio-btn').hasClass('muted')).to.equal(true)
      expect(chrome$('#' + ownInterfaceId + ' .video-btn').length).to.equal(1)
      expect(chrome$('#' + ownInterfaceId + ' .video-btn').hasClass('off')).to.equal(false)
      expect(chrome$('#' + ownInterfaceId + ' .enlarge-btn').length).to.equal(1)

      expect(chrome$('#' + otherInterfaceId + ' .audio-btn').hasClass('muted')).to.equal(true)
      expect(chrome$('#' + otherInterfaceId + ' .enlarge-btn').length).to.equal(1)
      done()
    });
  });

  context('Audio and Video hard disabled in clientVars', function() {
    beforeEach(function(done) {
      var chrome$ = helper.padChrome$;
      chrome$.window.clientVars.webrtc.audio.disabled = "hard"
      chrome$.window.clientVars.webrtc.video.disabled = "hard"
      chrome$('.interface-container').remove()
      helper.waitFor(function(){
        return chrome$(".interface-container").length === 0;
      }, 1000).done(done)
    });

    it('generates local and remote interfaces with video and audio hard-disabled', function(done) {
      var chrome$ = helper.padChrome$;

      chrome$.window.ep_webrtc.addInterface(ownUserId, fakeStream({audio: false, video: false}))
      chrome$.window.ep_webrtc.addInterface(otherUserId, fakeStream({audio: false, video: false}))

      expect(chrome$(".interface-container").length).to.equal(2)

      expect(chrome$('#' + ownInterfaceId + ' .audio-btn').length).to.equal(1)
      expect(chrome$('#' + ownInterfaceId + ' .audio-btn').hasClass('disallowed')).to.equal(true)
      expect(chrome$('#' + ownInterfaceId + ' .video-btn').length).to.equal(1)
      expect(chrome$('#' + ownInterfaceId + ' .video-btn').hasClass('disallowed')).to.equal(true)
      expect(chrome$('#' + ownInterfaceId + ' .enlarge-btn').length).to.equal(1)

      expect(chrome$('#' + otherInterfaceId + ' .audio-btn').hasClass('disallowed')).to.equal(true)
      expect(chrome$('#' + otherInterfaceId + ' .enlarge-btn').length).to.equal(1)
      done()
    });
  });
});
