'use strict';
/**
 * Copyright 2013 j <j@mailb.org>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const log4js = require('ep_etherpad-lite/node_modules/log4js');
const statsLogger = log4js.getLogger('stats');
const configLogger = log4js.getLogger('configuration');
const eejs = require('ep_etherpad-lite/node/eejs/');
const sessioninfos = require('ep_etherpad-lite/node/handler/PadMessageHandler').sessioninfos;
const stats = require('ep_etherpad-lite/node/stats');

const settings = {
  // The defaults here are overridden by the values in the `ep_webrtc` object from `settings.json`.
  enabled: true,
  audio: {
    disabled: 'none',
  },
  video: {
    disabled: 'none',
    sizes: {large: 260, small: 160},
  },
  iceServers: [{urls: ['stun:stun.l.google.com:19302']}],
  listenClass: null,
  moreInfoUrl: {},
};
let socketio;

// Copied from:
// https://github.com/ether/etherpad-lite/blob/f95b09e0b6752a0d226d58d8b246831164dc9533/src/node/handler/PadMessageHandler.js#L1411-L1420
const _getRoomSockets = (padId) => {
  const ns = socketio.sockets; // Default namespace.
  const adapter = ns.adapter;
  // We could call adapter.clients(), but that method is unnecessarily asynchronous. Replicate what
  // it does here, but synchronously to avoid a race condition. This code will have to change when
  // we update to socket.io v3.
  const room = adapter.rooms[padId];
  if (!room) return [];
  return Object.keys(room.sockets).map((id) => ns.connected[id]).filter((s) => s);
};

/**
 * Handles an RTC Message
 * @param socket The socket.io Socket object for the client that sent the message.
 * @param message the message from the client
 */
const handleRTCMessage = (socket, payload) => {
  const {[socket.id]: {author: userId, padId} = {}} = sessioninfos;
  // The handleMessage hook is executed asynchronously, so the user can disconnect between when the
  // message arrives at Etherpad and when this function is called.
  if (userId == null || padId == null) return;
  const msg = {
    type: 'COLLABROOM',
    data: {
      type: 'RTC_MESSAGE',
      payload: {
        from: userId,
        data: payload.data,
      },
    },
  };
  if (payload.to == null) {
    socket.to(padId).json.send(msg);
  } else {
    for (const socket of _getRoomSockets(padId)) {
      const session = sessioninfos[socket.id];
      if (session && session.author === payload.to) {
        socket.json.send(msg);
        break;
      }
    }
  }
};

// Make sure any updates to this are reflected in README
const statErrorNames = [
  'Abort',
  'Hardware',
  'NotFound',
  'Permission',
  'SecureConnection',
  'Unknown',
];

const handleErrorStatMessage = (statName) => {
  if (statErrorNames.includes(statName)) {
    stats.meter(`ep_webrtc_err_${statName}`).mark();
  } else {
    statsLogger.warn(`Invalid ep_webrtc error stat: ${statName}`);
  }
};

exports.clientVars = async (hookName, context) => ({ep_webrtc: settings});

exports.handleMessage = async (hookName, {message, socket}) => {
  if (message.type === 'COLLABROOM' && message.data.type === 'RTC_MESSAGE') {
    handleRTCMessage(socket, message.data.payload);
    return [null];
  }
  if (message.type === 'STATS' && message.data.type === 'RTC_MESSAGE') {
    handleErrorStatMessage(message.data.statName);
    return [null];
  }
};

exports.setSocketIO = (hookName, {io}) => { socketio = io; };

exports.eejsBlock_mySettings = (hookName, context) => {
  context.content += eejs.require('./templates/settings.ejs', {
    audio_hard_disabled: settings.audio.disabled === 'hard',
    video_hard_disabled: settings.video.disabled === 'hard',
  }, module);
};

exports.eejsBlock_styles = (hookName, context) => {
  context.content += eejs.require('./templates/styles.html', {}, module);
};

exports.loadSettings = async (hookName, {settings: {ep_webrtc = {}}}) => {
  const isObj = (o) => o != null && typeof o === 'object' && !Array.isArray(o);
  const merge = (target, source) => {
    for (const [k, sv] of Object.entries(source)) {
      const tv = target[k];
      // The own-property check on the target prevents prototype pollution. (Prototype pollution
      // shouldn't be exploitable here because the source comes from admin-controlled settings.json,
      // but the check is added anyway to hopefully pacify static analysis tools.)
      if (Object.prototype.hasOwnProperty.call(target, k) && isObj(tv) && isObj(sv)) merge(tv, sv);
      else target[k] = sv;
    }
  };
  merge(settings, ep_webrtc);
  settings.configError = (() => {
    for (const k of ['audio', 'video']) {
      const {[k]: {disabled} = {}} = settings;
      if (disabled != null && !['none', 'hard', 'soft'].includes(disabled)) {
        configLogger.error(`Invalid value in settings.json for ep_webrtc.${k}.disabled`);
        return true;
      }
    }
    return false;
  })();
};
