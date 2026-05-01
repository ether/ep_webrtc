import {expect, test} from '@playwright/test';
import {cartesian, goToNewPadWithParams, setPadPrefsCookie} from '../helper/utils';

const testCases = [...cartesian(
    [null, false, true] as Array<boolean | null>,
    [null, false, true, 'NO', 'YES', 'ignored'] as Array<boolean | string | null>)];

test.describe('enable/disable', () => {
  for (const [cookieVal, queryVal] of testCases) {
    test.describe(`cookie=${cookieVal} query=${queryVal}`, () => {
      // serial: tests within share state from beforeAll on a single page.
      test.describe.configure({mode: 'serial'});

      let sharedPage: import('@playwright/test').Page;
      let wantChecked: boolean;

      test.beforeAll(async ({browser}) => {
        sharedPage = await browser.newPage();
        test.setTimeout(60_000);
        const padPrefs = cookieVal == null ? {} : {rtcEnabled: cookieVal};
        // Make ep_webrtc's enumerateDevices()-based auto-activate skip
        // happy: pretend a camera/mic is present (and supply a fake
        // getUserMedia) BEFORE navigation so postAceInit sees devices.
        await sharedPage.addInitScript(() => {
          const w = window as any;
          const fakeStream = () => new MediaStream();
          w.navigator.mediaDevices.enumerateDevices = async () => [
            {kind: 'audioinput', deviceId: 'fake-audio', groupId: 'fake', label: 'fake mic'},
            {kind: 'videoinput', deviceId: 'fake-video', groupId: 'fake', label: 'fake cam'},
          ];
          w.navigator.mediaDevices.getUserMedia = async () => fakeStream();
        });
        await setPadPrefsCookie(sharedPage, padPrefs);
        const params: Record<string, any> = {};
        if (queryVal != null) params.av = queryVal;
        await goToNewPadWithParams(sharedPage, params);
        // Normalize queryVal to null/false/true.
        const queryNorm: boolean | null =
            typeof queryVal === 'boolean' ? queryVal
            : queryVal === 'NO' ? false
            : queryVal === 'YES' ? true
            : null;
        await sharedPage.waitForFunction(() => {
          const w = window as any;
          return w.$('#rtcbox').data('initialized');
        }, undefined, {timeout: 5000});
        const defaultChecked: boolean = await sharedPage.evaluate(
            () => !!(window as any).ep_webrtc._settings.enabled);
        wantChecked = !!(queryNorm || (queryNorm == null && cookieVal) ||
                         (queryNorm == null && cookieVal == null && defaultChecked));
      });

      test.afterAll(async () => {
        await sharedPage.close();
      });

      test('checkbox is checked/unchecked', async () => {
        const checked = await sharedPage.locator('#options-enablertc')
            .evaluate((el) => (el as HTMLInputElement).checked);
        expect(checked).toBe(wantChecked);
      });

      test('self video element', async () => {
        const count = await sharedPage.locator('#rtcbox video').count();
        expect(count).toBe(wantChecked ? 1 : 0);
      });

      test('clicking checkbox toggles state', async () => {
        await sharedPage.locator('#options-enablertc').evaluate((el) => {
          (window as any).$(el).click();
        });
        const checked = await sharedPage.locator('#options-enablertc')
            .evaluate((el) => (el as HTMLInputElement).checked);
        expect(checked).toBe(!wantChecked);
        await sharedPage.waitForFunction((expected) => {
          return document.querySelectorAll('#rtcbox video').length === expected;
        }, wantChecked ? 0 : 1);
      });
    });
  }
});
