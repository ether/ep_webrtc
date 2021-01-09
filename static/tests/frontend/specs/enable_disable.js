/* eslint max-len: ["error", { "code": 120 }] */
'use strict';

describe('enable and disable webrtc', function () {
  context('WebRTC is disabled', function () {
    before(async function () {
      await helper.newPad({
        padPrefs: {rtcEnabled: false, fakeWebrtcFirefox: true},
      });
      this.timeout(60000);
    });

    it('enables WebRTC if the user uses the setting', function (done) {
      const chrome$ = helper.padChrome$;
      const $enableRtc = chrome$('#options-enablertc');
      expect($enableRtc.prop('checked')).to.be(false);
      expect(chrome$('#rtcbox video').length).to.be(0);

      $enableRtc.click();

      expect($enableRtc.prop('checked')).to.be(true);

      helper.waitFor(() => chrome$('#rtcbox video').length === 1, 1000).done(done);
    });
  });

  context('WebRTC is enabled', function () {
    before(async function () {
      await helper.newPad({
        padPrefs: {rtcEnabled: true, fakeWebrtcFirefox: true},
      });
      this.timeout(60000);
    });

    it('disables WebRTC if the user uses the setting', function (done) {
      const chrome$ = helper.padChrome$;
      const $enableRtc = chrome$('#options-enablertc');
      expect($enableRtc.prop('checked')).to.be(true);
      helper.waitFor(() => chrome$('#rtcbox video').length === 1, 1000).done(() => {
        $enableRtc.click();

        expect($enableRtc.prop('checked')).to.be(false);

        expect(chrome$('#rtcbox video').length).to.be(0);
        done();
      });
    });
  });
});
