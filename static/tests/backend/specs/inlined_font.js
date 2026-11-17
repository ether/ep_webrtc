'use strict';

// styles.css inlines fontawesome-custom.woff2 as a data URI (a relative url()
// broke under Etherpad's production CSS minifier). Keep the inlined copy in
// sync with the source font so regenerating the icon set can't leave the
// stylesheet serving a stale glyph set.

const assert = require('assert').strict;
const fsp = require('fs').promises;
const path = require('path');

const root = path.join(__dirname, '../../../..');

describe(__filename, function () {
  it('inlined @font-face matches fontawesome-custom.woff2', async function () {
    const css = await fsp.readFile(path.join(root, 'static/css/styles.css'), 'utf8');
    const m = /url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/.exec(css);
    assert(m, 'expected an inlined woff2 data URI in static/css/styles.css');
    const font = await fsp.readFile(
        path.join(root, 'static/fonts/fontello/font/fontawesome-custom.woff2'));
    assert(Buffer.from(m[1], 'base64').equals(font),
        'inlined font differs from fontawesome-custom.woff2; regenerate with ' +
        '`base64 -w0 static/fonts/fontello/font/fontawesome-custom.woff2`');
  });
});
