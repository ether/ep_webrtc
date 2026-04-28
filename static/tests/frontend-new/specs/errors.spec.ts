import {expect, test} from '@playwright/test';
import {goToNewPadWithParams} from '../helper/utils';

const testCases: Array<[string, string]> = [
  // Hard to test the version of NotAllowedError that is the SSL error
  // because it requires changing window.location
  ['NotAllowedError', 'Failed to get permission to access'],
  ['NotFoundError', 'Failed to access'],
  ['NotReadableError', 'hardware error occurred'],
  ['AbortError', 'not a hardware error'],
];

test.describe('error handling', () => {
  test.describe.configure({mode: 'serial'});
  let sharedPage: import('@playwright/test').Page;
  let videoBtnSelector: string;

  test.beforeAll(async ({browser}) => {
    sharedPage = await browser.newPage();
    test.setTimeout(60_000);
    await goToNewPadWithParams(sharedPage, {
      av: true,
      webrtcaudioenabled: false,
      webrtcvideoenabled: false,
    });
    await sharedPage.waitForFunction(
        () => (window as any).$('#rtcbox').data('initialized'));
    const ownInterfaceId: string = await sharedPage.evaluate(() => {
      const w = window as any;
      const ownUserId = w.ep_webrtc.getUserId();
      const ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
      return `interface_${ownVideoId}`;
    });
    videoBtnSelector = `#${ownInterfaceId} .video-btn`;
    // Save the original getUserMedia for restore in afterAll.
    await sharedPage.evaluate(() => {
      const w = window as any;
      w.__getUserMediaBackup = w.navigator.mediaDevices.getUserMedia;
    });
  });

  test.afterAll(async () => {
    await sharedPage.evaluate(() => {
      const w = window as any;
      w.navigator.mediaDevices.getUserMedia = w.__getUserMediaBackup;
    });
    await sharedPage.close();
  });

  test.beforeEach(async () => {
    // No idea why but this needs to be called twice to actually make
    // #gritter-container hidden.
    await sharedPage.evaluate(() => {
      const w = window as any;
      w.gritter.removeAll({fade: false});
      w.gritter.removeAll({fade: false});
    });
    const off = await sharedPage.locator(videoBtnSelector).evaluate(
        (el) => el.classList.contains('off'));
    expect(off).toBe(true);
  });

  for (const [errName, checkString] of testCases) {
    test(errName, async () => {
      await sharedPage.evaluate((errName) => {
        const w = window as any;
        w.navigator.mediaDevices.getUserMedia = async () => {
          const err: any = new Error();
          err.name = errName;
          throw err;
        };
      }, errName);
      await sharedPage.waitForFunction(() => {
        const w = window as any;
        return w.$('#gritter-container:visible').length === 0;
      }, undefined, {timeout: 1000});
      await sharedPage.locator(videoBtnSelector).evaluate((el) => {
        (window as any).$(el).click();
      });
      await sharedPage.waitForFunction(() => {
        const w = window as any;
        return w.$('#gritter-container:visible').length === 1;
      }, undefined, {timeout: 1000});
      const titleHtml = await sharedPage.evaluate(
          () => (window as any).$('.gritter-title').html());
      expect(titleHtml).toBe('Error');
      const contentHtml = await sharedPage.evaluate(
          () => (window as any).$('.gritter-content p').html());
      expect(contentHtml).toContain(checkString);
    });
  }
});
