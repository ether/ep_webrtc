import {expect, test} from '@playwright/test';
import {cartesian, goToNewPadWithParams, setPadPrefsCookie} from '../helper/utils';

type Tc = {
  name: string;
  defaultVal: boolean;
  cookieVal: boolean | null;
  queryVal: boolean | null;
  i: number;
  id: string;
  want: boolean;
};

const testCases: Tc[] = [...cartesian(
    [false, true] as boolean[],
    [null, false, true] as Array<boolean | null>,
    [null, false, true] as Array<boolean | null>)].map(([defaultVal, cookieVal, queryVal], i) => ({
  name: `default=${defaultVal} cookie=${cookieVal} query=${queryVal}`,
  defaultVal: defaultVal as boolean,
  cookieVal: cookieVal as boolean | null,
  queryVal: queryVal as boolean | null,
  i,
  id: `checkboxId${i}`,
  want: !!((queryVal as boolean | null) ||
            (queryVal == null && cookieVal) ||
            (queryVal == null && cookieVal == null && defaultVal)),
}));

test.describe('settingToCheckbox', () => {
  // Use a serial worker so the single before-all setup persists across tests
  // (legacy used mocha's `before` for one-shot setup).
  test.describe.configure({mode: 'serial'});

  let sharedPage: import('@playwright/test').Page;

  test.beforeAll(async ({browser}) => {
    sharedPage = await browser.newPage();
    test.setTimeout(60_000);
    const padPrefs: Record<string, any> = {};
    for (const tc of testCases) {
      if (tc.cookieVal != null) padPrefs[`cookie${tc.i}`] = tc.cookieVal;
    }
    await setPadPrefsCookie(sharedPage, padPrefs);
    const params: Record<string, any> = {av: false};
    for (const tc of testCases) {
      if (tc.queryVal != null) params[`urlVar${tc.i}`] = tc.queryVal;
    }
    await goToNewPadWithParams(sharedPage, params);
    // Append a checkbox per testCase to #settings then call settingToCheckbox.
    await sharedPage.evaluate((cases) => {
      const w = window as any;
      const $ = w.$;
      for (const c of cases) {
        $('#settings').append($('<input>').attr('type', 'checkbox').attr('id', c.id));
      }
    }, testCases.map(({id}) => ({id})));
    // Wait for all checkboxes to exist.
    await sharedPage.waitForFunction((cases) => {
      for (const c of cases) {
        if (document.querySelectorAll(`#${c.id}`).length !== 1) return false;
      }
      return true;
    }, testCases.map(({id}) => ({id})));
    await sharedPage.evaluate((cases) => {
      const w = window as any;
      for (const c of cases) {
        w.ep_webrtc.settingToCheckbox({
          urlVar: `urlVar${c.i}`,
          cookie: `cookie${c.i}`,
          defaultVal: c.defaultVal,
          checkboxId: `#${c.id}`,
        });
      }
    }, testCases.map(({i, id, defaultVal}) => ({i, id, defaultVal})));
  });

  test.afterAll(async () => {
    await sharedPage.close();
  });

  test.describe('initially checked/unchecked', () => {
    for (const {name, want, id} of testCases) {
      test(name, async () => {
        const checked = await sharedPage.locator(`#${id}`)
            .evaluate((el) => (el as HTMLInputElement).checked);
        expect(checked).toBe(want);
      });
    }
  });

  test.describe('query parameter sets cookie', () => {
    for (const {name, queryVal, i} of testCases.filter((t) => t.queryVal != null)) {
      test(name, async () => {
        const v = await sharedPage.evaluate((i) => {
          const w = window as any;
          const padcookie = w.require('ep_etherpad-lite/static/js/pad_cookie').padcookie;
          return padcookie.getPref(`cookie${i}`);
        }, i);
        expect(v).toBe(queryVal);
      });
    }
  });

  test.describe('no query parameter, no cookie -> cookie not set', () => {
    for (const {name, queryVal, cookieVal, i} of testCases) {
      if (queryVal != null || cookieVal != null) continue;
      test(name, async () => {
        const v = await sharedPage.evaluate((i) => {
          const w = window as any;
          const padcookie = w.require('ep_etherpad-lite/static/js/pad_cookie').padcookie;
          return padcookie.getPref(`cookie${i}`);
        }, i);
        expect(v == null).toBe(true);
      });
    }
  });

  test.describe('clicking sets cookie', () => {
    for (const {name, i, id, want} of testCases) {
      test(name, async () => {
        await sharedPage.locator(`#${id}`).evaluate((el) => {
          const w = window as any;
          w.$(el).click();
        });
        await sharedPage.waitForFunction(({id, want}) => {
          const cb = document.querySelector(`#${id}`) as HTMLInputElement | null;
          return cb != null && cb.checked === !want;
        }, {id, want});
        const v = await sharedPage.evaluate((i) => {
          const w = window as any;
          const padcookie = w.require('ep_etherpad-lite/static/js/pad_cookie').padcookie;
          return padcookie.getPref(`cookie${i}`);
        }, i);
        expect(v).toBe(!want);
      });
    }
  });

  test.describe('throws errors for missing params', () => {
    const params = {
      urlVar: 'urlVar',
      cookie: 'cookie',
      defaultVal: true,
      checkboxId: '#checkboxId',
    };

    for (const k of Object.keys(params) as Array<keyof typeof params>) {
      test(k, async () => {
        const result = await sharedPage.evaluate(({params, k}) => {
          const w = window as any;
          const badParams: any = {...params};
          delete badParams[k];
          try {
            w.ep_webrtc.settingToCheckbox(badParams);
            return {threw: false, msg: ''};
          } catch (e: any) {
            return {threw: true, msg: String(e && (e.message || e))};
          }
        }, {params, k});
        expect(result.threw).toBe(true);
        expect(result.msg).toMatch(new RegExp(k));
      });
    }
  });
});
