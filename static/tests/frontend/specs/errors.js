'use strict';

describe('error handling', function () {
  let chrome$;
  let $videoBtn;
  let getUserMediaBackup;

  const testCases = [
    // Hard to test the version of NotAllowedError that is the SSL error
    // because it requires changing window.location
    ['NotAllowedError', 'Failed to get permission to access'],
    ['NotFoundError', 'Failed to access'],
    ['NotReadableError', 'hardware error occurred'],
    ['AbortError', 'not a hardware error'],
  ];

  before(async function () {
    this.timeout(60000);
    await helper.aNewPad({params: {
      av: true,
      webrtcaudioenabled: false,
      webrtcvideoenabled: false,
    }});
    chrome$ = helper.padChrome$;
    await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
    const ownUserId = chrome$.window.ep_webrtc.getUserId();
    const ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
    const ownInterfaceId = `interface_${ownVideoId}`;
    $videoBtn = chrome$(`#${ownInterfaceId} .video-btn`);
    getUserMediaBackup = chrome$.window.navigator.mediaDevices.getUserMedia;
  });

  after(async function () {
    chrome$.window.navigator.mediaDevices.getUserMedia = getUserMediaBackup;
  });

  beforeEach(async function () {
    // No idea why but this needs to be called twice to actually make #gritter-container hidden
    chrome$.gritter.removeAll({fade: false});
    chrome$.gritter.removeAll({fade: false});
    expect($videoBtn.hasClass('off')).to.equal(true);
  });

  for (const [errName, checkString] of testCases) {
    it(errName, async function () {
      chrome$.window.navigator.mediaDevices.getUserMedia = async () => {
        const err = new Error();
        err.name = errName;
        throw err;
      };
      await helper.waitForPromise(() => chrome$('#gritter-container:visible').length === 0, 1000);
      $videoBtn.click();
      await helper.waitForPromise(() => chrome$('#gritter-container:visible').length === 1, 1000);
      expect(chrome$('.gritter-title').html()).to.be('Error');
      expect(chrome$('.gritter-content p').html()).to.contain(checkString);
    });
  }
});
