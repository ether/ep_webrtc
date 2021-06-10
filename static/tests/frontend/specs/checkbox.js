'use strict';

const {cartesian} = require('ep_webrtc/static/tests/frontend/utils');

describe('settingToCheckbox', function () {
  const testCases = [
    ...cartesian([false, true], [null, false, true], [null, false, true]),
  ].map(([defaultVal, cookieVal, queryVal], i) => ({
    name: `default=${defaultVal} cookie=${cookieVal} query=${queryVal}`,
    defaultVal,
    cookieVal,
    queryVal,
    i,
    id: `checkboxId${i}`,
    want: queryVal ||
        (queryVal == null && cookieVal) ||
        (queryVal == null && cookieVal == null && defaultVal),
  }));
  let chrome$;
  let padcookie;

  before(async function () {
    this.timeout(60000);
    await helper.aNewPad({
      padPrefs: Object.assign({}, ...testCases
          .filter(({cookieVal}) => cookieVal != null)
          .map(({cookieVal, i}) => ({[`cookie${i}`]: cookieVal}))),
      params: Object.assign({av: false}, ...testCases
          .filter(({queryVal}) => queryVal != null)
          .map(({queryVal, i}) => ({[`urlVar${i}`]: queryVal}))),
    });
    chrome$ = helper.padChrome$;
    padcookie = chrome$.window.require('ep_etherpad-lite/static/js/pad_cookie').padcookie;
    for (const {id} of testCases) {
      chrome$('#settings').append(chrome$('<input>').attr('type', 'checkbox').attr('id', id));
    }
    await helper.waitForPromise(() => {
      for (const {id} of testCases) {
        if (chrome$(`#${id}`).length !== 1) return false;
      }
      return true;
    });
    for (const {defaultVal, i, id} of testCases) {
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: `urlVar${i}`,
        cookie: `cookie${i}`,
        defaultVal,
        checkboxId: `#${id}`,
      });
    }
  });

  describe('initially checked/unchecked', function () {
    for (const {name, want, id} of testCases) {
      it(name, async function () {
        expect(chrome$(`#${id}`).prop('checked')).to.equal(want);
      });
    }
  });

  describe('query parameter sets cookie', function () {
    for (const {name, queryVal, i} of testCases.filter(({queryVal}) => queryVal != null)) {
      it(name, async function () {
        expect(padcookie.getPref(`cookie${i}`)).to.equal(queryVal);
      });
    }
  });

  describe('no query parameter, no cookie -> cookie not set', function () {
    for (const {name, queryVal, cookieVal, i} of testCases) {
      if (queryVal != null || cookieVal != null) continue;
      it(name, async function () {
        expect(padcookie.getPref(`cookie${i}`) == null).to.be(true);
      });
    }
  });

  describe('clicking sets cookie', function () {
    for (const {name, i, id, want} of testCases) {
      it(name, async function () {
        const cb = chrome$(`#${id}`);
        cb.click();
        await helper.waitForPromise(() => cb.prop('checked') === !want);
        expect(padcookie.getPref(`cookie${i}`)).to.equal(!want);
      });
    }
  });

  describe('throws errors for missing params', function () {
    const params = {
      urlVar: 'urlVar',
      cookie: 'cookie',
      defaultVal: true,
      checkboxId: '#checkboxId',
    };

    for (const k of Object.keys(params)) {
      const badParams = Object.assign({}, params);
      delete badParams[k];

      it(k, async function () {
        expect(() => chrome$.window.ep_webrtc.settingToCheckbox(badParams))
            .to.throwError(new RegExp(k));
      });
    }
  });
});
