'use strict';

describe('enable/disable', function () {
  const cartesian = function* (head, ...tail) {
    const remainder = tail.length > 0 ? cartesian(...tail) : [[]];
    for (const r of remainder) for (const h of head) yield [h, ...r];
  };

  const testCases = cartesian([null, false, true], [null, 'YES', 'ignored']);

  for (const [cookieVal, queryVal] of testCases) {
    describe(`cookie=${cookieVal} query=${queryVal}`, function () {
      let chrome$;
      let wantChecked;
      let checkbox;

      before(async function () {
        this.timeout(60000);
        await helper.aNewPad({
          padPrefs: Object.assign({
            fakeWebrtcFirefox: true,
          }, cookieVal == null ? {} : {rtcEnabled: cookieVal}),
          params: queryVal == null ? {} : {av: queryVal},
        });
        chrome$ = helper.padChrome$;
        // Normalize queryVal to null/false/true.
        const queryNorm = queryVal === 'YES' ? true : null;
        const defaultChecked = !!chrome$.window.clientVars.webrtc.enabled;
        wantChecked = (queryNorm || (queryNorm == null && cookieVal) ||
                       (queryNorm == null && cookieVal == null && defaultChecked));
        checkbox = chrome$('#options-enablertc');
        await helper.waitForPromise(() => chrome$('#rtcbox').data('initialized'));
      });

      it('checkbox is checked/unchecked', async function () {
        expect(checkbox.prop('checked')).to.equal(wantChecked);
      });

      it('self video element', async function () {
        expect(chrome$('#rtcbox video').length).to.equal(wantChecked ? 1 : 0);
      });

      it('clicking checkbox toggles state', async function () {
        checkbox.click();
        expect(checkbox.prop('checked')).to.equal(!wantChecked);
        await helper.waitForPromise(
            () => chrome$('#rtcbox video').length === (wantChecked ? 0 : 1));
      });
    });
  }
});
