'use strict';

const common = require('ep_etherpad-lite/tests/backend/common');
const fsp = require('fs').promises;
const path = require('path');
const pluginDefs = require('ep_etherpad-lite/static/js/pluginfw/plugin_defs');
const plugins = require('ep_etherpad-lite/static/js/pluginfw/plugins');

module.exports = async () => {
  const agent = await common.init();
  if (pluginDefs.plugins.ep_webrtc == null) {
    const packagePath = path.dirname(require.resolve('../../../package.json'));
    plugins.getPackages = async () => ({
      'ep_etherpad-lite': pluginDefs.plugins['ep_etherpad-lite'].package,
      'ep_webrtc': {
        ...require('../../../package.json'),
        path: packagePath,
        realPath: await fsp.realpath(packagePath),
      },
    });
    await plugins.update();
  }
  return agent;
};
