import {expect, test} from '@playwright/test';
import {cartesian, goToNewPadWithParams, installFakeGetUserMedia, setPadPrefsCookie}
    from '../helper/utils';

test.describe('audio/video on/off according to query parameters/cookies', () => {
  const testCases = [...cartesian(
      ['audio', 'video'] as Array<'audio' | 'video'>,
      [null, false, true],
      [null, false, true])];

  for (const [avType, cookieVal, queryVal] of testCases) {
    test(`${avType} cookie=${cookieVal} query=${queryVal}`, async ({page, context}) => {
      test.setTimeout(60_000);
      await context.clearCookies();
      const padPrefs = cookieVal == null ? {} : {[`${avType}EnabledOnStart`]: cookieVal};
      await setPadPrefsCookie(page, padPrefs);
      const params: Record<string, any> = {av: false};
      if (queryVal != null) params[`webrtc${avType}enabled`] = queryVal;
      await goToNewPadWithParams(page, params);
      await installFakeGetUserMedia(page);
      // Calling activate() directly blocks until activation completes.
      await page.evaluate(() => (window as any).ep_webrtc.activate());
      const disabled: string = await page.evaluate(
          (avType) => (window as any).ep_webrtc._settings[avType].disabled, avType);
      const checkboxCount = await page.locator(`#options-${avType}enabledonstart`).count();
      if (disabled === 'hard') {
        expect(checkboxCount).toBe(0);
      } else {
        const wantChecked = !!(queryVal || (queryVal == null && cookieVal) ||
                                (queryVal == null && cookieVal == null && disabled === 'none'));
        const checked = await page.locator(`#options-${avType}enabledonstart`)
            .evaluate((el) => (el as HTMLInputElement).checked);
        expect(checked).toBe(wantChecked);
      }
    });
  }
});
