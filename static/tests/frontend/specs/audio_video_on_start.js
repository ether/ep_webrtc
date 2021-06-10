'use strict';

const {cartesian, fakeGetUserMedia} = require('ep_webrtc/static/tests/frontend/utils');

describe('audio/video on/off according to query parameters/cookies', function () {
  const testCases = cartesian(['audio', 'video'], [null, false, true], [null, false, true]);

  for (const [avType, cookieVal, queryVal] of testCases) {
    it(`${avType} cookie=${cookieVal} query=${queryVal}`, async function () {
      this.timeout(60000);
      await helper.aNewPad({
        padPrefs: cookieVal == null ? {} : {[`${avType}EnabledOnStart`]: cookieVal},
        params: Object.assign({
          // Disable WebRTC so we can install a fake getUserMedia() before WebRTC stuff is
          // initialized.
          av: false,
        }, queryVal == null ? {} : {[`webrtc${avType}enabled`]: queryVal}),
      });
      const chrome$ = helper.padChrome$;
      chrome$.window.navigator.mediaDevices.getUserMedia = fakeGetUserMedia;
      // Clicking $(#options-enablertc) also activates, but calling activate() directly blocks until
      // activation is complete.
      await chrome$.window.ep_webrtc.activate();
      const {disabled} = chrome$.window.clientVars.webrtc[avType];
      const checkbox = chrome$(`#options-${avType}enabledonstart`);
      if (disabled === 'hard') {
        expect(checkbox.length).to.equal(0); // There shouldn't even be a checkbox.
      } else {
        const wantChecked = (queryVal || (queryVal == null && cookieVal) ||
                             (queryVal == null && cookieVal == null && disabled === 'none'));
        expect(checkbox.prop('checked')).to.equal(wantChecked);
      }
    });
  }
});
