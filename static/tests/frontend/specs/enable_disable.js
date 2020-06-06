describe('enable and disable webrtc', function() {
  context('WebRTC is disabled', function() {
    before(function(done) {
      helper.newPad({
        padPrefs: {rtcEnabled: false, fakeWebrtcFirefox: true},
        cb: done
      });
      this.timeout(60000);
    });

    it('enables WebRTC if the user uses the setting', function(done) {
      var chrome$ = helper.padChrome$;
      var $enableRtc = chrome$("#options-enablertc");
      expect($enableRtc.prop("checked")).to.be(false)
      expect(chrome$("#rtcbox video").length).to.be(0)

      $enableRtc.click();

      expect($enableRtc.prop("checked")).to.be(true)

      helper.waitFor(function(){
        return chrome$("#rtcbox video").length === 1;
      }, 1000).done(done);
    });
  });

  context('WebRTC is enabled', function() {
    before(function(done) {
      helper.newPad({
        padPrefs: {rtcEnabled: true, fakeWebrtcFirefox: true},
        cb: done
      });
      this.timeout(60000);
    });

    it('disables WebRTC if the user uses the setting', function(done) {
      var chrome$ = helper.padChrome$;
      var $enableRtc = chrome$("#options-enablertc");
      expect($enableRtc.prop("checked")).to.be(true)
      helper.waitFor(function(){
        return chrome$("#rtcbox video").length === 1;
      }, 1000).done(function () {

        $enableRtc.click();

        expect($enableRtc.prop("checked")).to.be(false)

        expect(chrome$("#rtcbox video").length).to.be(0)
        done()
      });
    });
  });

});
