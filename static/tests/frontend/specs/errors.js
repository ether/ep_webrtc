/* eslint max-len: ["error", { "code": 120 }] */
'use strict';

describe('Test that we show the correct error messages when trying to start webrtc', function () {
  before(async function () {
    // Make sure webrtc starts disabled so we have time to wrap getUserMedia
    await helper.newPad({
      padPrefs: {
        rtcEnabled: true,
        fakeWebrtcFirefox: true,
      },
    });
    this.timeout(60000);
  });

  beforeEach(function (done) {
    const chrome$ = helper.padChrome$;
    // No idea why but this needs to be called twice to actually make #gritter-container hidden
    chrome$.gritter.removeAll({fade: false});
    chrome$.gritter.removeAll({fade: false});
    done();
  });

  function tryError(errName, checkString, done) {
    const chrome$ = helper.padChrome$;

    chrome$.window.navigator.mediaDevices.getUserMedia = function () {
      return new Promise(((resolve, reject) => {
        const err = Error();
        err.name = errName;
        reject(err);
      }));
    };

    helper.waitFor(() => chrome$('#gritter-container:visible').length === 0, 1000).done(() => {
      // a wrapper of the above, which includes displaying errors
      chrome$.window.ep_webrtc.getUserMedia();

      helper.waitFor(() => chrome$('#gritter-container:visible').length === 1, 1000).done(() => {
        expect(chrome$('.gritter-title').html()).to.be('Error');
        expect(chrome$('.gritter-content p').html()).to.contain(checkString);
        done();
      });
    });
  }

  it('gives the right error message for CustomNotSupportedError', function (done) {
    tryError('CustomNotSupportedError', 'does not support WebRTC', done);
  });

  it('gives the right error message for CustomSecureConnectionError', function (done) {
    tryError('CustomSecureConnectionError', 'need to install SSL certificates', done);
  });

  it('gives the right error message for NotAllowedError', function (done) {
    // Hard to test the version of NotAllowedError that is the SSL error
    // because it requires changing window.location
    tryError('NotAllowedError', 'need to give us permission', done);
  });

  it('gives the right error message for NotFoundError', function (done) {
    tryError('NotFoundError', "couldn't find a suitable camera", done);
  });

  it('gives the right error message for NotReadableError', function (done) {
    tryError('NotReadableError', 'hardware error occurred', done);
  });

  it('gives the right error message for AbortError', function (done) {
    tryError('AbortError', 'not a hardware error', done);
  });

  it('gives the right error message for an unknown error', function (done) {
    tryError('asdf', 'there was an unknown error', done);
  });
});
