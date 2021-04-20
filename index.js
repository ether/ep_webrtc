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

let settings;
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
 * @param client the client that send this message
 * @param message the message from the client
 */
const handleRTCMessage = (client, payload) => {
  const {[client.id]: {author: userId, padId} = {}} = sessioninfos;
  // The handleMessage hook is executed asynchronously, so the user can disconnect between when the
  // message arrives at Etherpad and when this function is called.
  if (userId == null || padId == null) return;
  const to = payload.to;
  const clients = _getRoomSockets(padId);

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
  // Lookup recipient and send message
  for (let i = 0; i < clients.length; i++) {
    const session = sessioninfos[clients[i].id];
    if (session && session.author === to) {
      clients[i].json.send(msg);
      break;
    }
  }
};

// Make sure any updates to this are reflected in README
const statErrorNames = [
  'Abort',
  'Hardware',
  'NotFound',
  'NotSupported',
  'Permission',
  'SecureConnection',
  'Unknown',
];

const handleErrorStatMessage = (statName) => {
  if (statErrorNames.indexOf(statName) !== -1) {
    stats.meter(`ep_webrtc_err_${statName}`).mark();
  } else {
    statsLogger.warn(`Invalid ep_webrtc error stat: ${statName}`);
  }
};

exports.clientVars = (hook, context, callback) => {
  // Validate settings.json now so that the admin notices any errors right away
  if (!validateSettings()) {
    return callback({
      webrtc: {
        configError: true,
      },
    });
  }

  let enabled = true;
  if (settings.enabled === false) {
    enabled = settings.enabled;
  }

  let audioDisabled = 'none';
  if (settings.audio) {
    audioDisabled = settings.audio.disabled;
  }

  let videoDisabled = 'none';
  if (settings.video) {
    videoDisabled = settings.video.disabled;
  }

  let iceServers = [{url: 'stun:stun.l.google.com:19302'}];
  if (settings.iceServers) {
    iceServers = settings.iceServers;
  }

  let listenClass = false;
  if (settings.listenClass) {
    listenClass = settings.listenClass;
  }

  let videoSizes = {};
  if (settings.video && settings.video.sizes) {
    videoSizes = {
      large: settings.video.sizes.large,
      small: settings.video.sizes.small,
    };
  }

  return callback({
    webrtc: {
      iceServers,
      enabled,
      audio: {disabled: audioDisabled},
      video: {disabled: videoDisabled, sizes: videoSizes},
      listenClass,
    },
  });
};

exports.handleMessage = (hook, context, callback) => {
  if (context.message.type === 'COLLABROOM' && context.message.data.type === 'RTC_MESSAGE') {
    handleRTCMessage(context.client, context.message.data.payload);
    callback([null]);
  } else if (context.message.type === 'STATS' && context.message.data.type === 'RTC_MESSAGE') {
    handleErrorStatMessage(context.message.data.statName);
    callback([null]);
  } else {
    callback();
  }
};

exports.setSocketIO = (hook, context, callback) => {
  socketio = context.io;
  callback();
};

exports.eejsBlock_mySettings = (hook, context, callback) => {
  const enabled = (settings.enabled === false)
    ? 'unchecked'
    : 'checked';

  let audioDisabled = 'none';
  if (settings.audio) {
    audioDisabled = settings.audio.disabled;
  }

  let videoDisabled = 'none';
  if (settings.video) {
    videoDisabled = settings.video.disabled;
  }

  context.content += eejs.require('./templates/settings.ejs', {
    enabled,
    audio_hard_disabled: audioDisabled === 'hard',
    video_hard_disabled: videoDisabled === 'hard',
  }, module);
  callback();
};

exports.eejsBlock_editorContainerBox = (hookName, args, cb) => {
  args.content += eejs.require('./templates/webrtc.ejs', {}, module);
  return cb();
};

exports.eejsBlock_styles = (hookName, args, cb) => {
  args.content += eejs.require('./templates/styles.html', {}, module);
  return cb();
};

exports.loadSettings = async (hookName, {settings: {ep_webrtc = {}}}) => {
  settings = ep_webrtc;
};

const validateSettings = () => {
  for (const k of ['audio', 'video']) {
    const {[k]: {disabled} = {}} = settings;
    if (disabled != null && !['none', 'hard', 'soft'].includes(disabled)) {
      configLogger.error(`Invalid value in settings.json for ep_webrtc.${k}.disabled`);
      return false;
    }
  }
  return true;
};
