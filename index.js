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
const settings = require('ep_etherpad-lite/node/utils/Settings');
const sessioninfos = require('ep_etherpad-lite/node/handler/PadMessageHandler').sessioninfos;
const stats = require('ep_etherpad-lite/node/stats');
let socketio;

/**
 * Handles an RTC Message
 * @param client the client that send this message
 * @param message the message from the client
 */
const handleRTCMessage = (client, payload) => {
  const userId = sessioninfos[client.id].author;
  const to = payload.to;
  const padId = sessioninfos[client.id].padId;
  const room = socketio.sockets.adapter.rooms[padId];
  const clients = [];

  if (room && room.sockets) {
    for (const id of Object.keys(room.sockets)) {
      clients.push(socketio.sockets.sockets[id]);
    }
  }

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
  if (settings.ep_webrtc && settings.ep_webrtc.enabled === false) {
    enabled = settings.ep_webrtc.enabled;
  }

  let audioDisabled = 'none';
  if (settings.ep_webrtc && settings.ep_webrtc.audio) {
    audioDisabled = settings.ep_webrtc.audio.disabled;
  }

  let videoDisabled = 'none';
  if (settings.ep_webrtc && settings.ep_webrtc.video) {
    videoDisabled = settings.ep_webrtc.video.disabled;
  }

  let iceServers = [{url: 'stun:stun.l.google.com:19302'}];
  if (settings.ep_webrtc && settings.ep_webrtc.iceServers) {
    iceServers = settings.ep_webrtc.iceServers;
  }

  let listenClass = false;
  if (settings.ep_webrtc && settings.ep_webrtc.listenClass) {
    listenClass = settings.ep_webrtc.listenClass;
  }

  let videoSizes = {};
  if (settings.ep_webrtc && settings.ep_webrtc.video && settings.ep_webrtc.video.sizes) {
    videoSizes = {
      large: settings.ep_webrtc.video.sizes.large,
      small: settings.ep_webrtc.video.sizes.small,
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
  const enabled = (settings.ep_webrtc && settings.ep_webrtc.enabled === false)
    ? 'unchecked'
    : 'checked';

  let audioDisabled = 'none';
  if (settings.ep_webrtc && settings.ep_webrtc.audio) {
    audioDisabled = settings.ep_webrtc.audio.disabled;
  }

  let videoDisabled = 'none';
  if (settings.ep_webrtc && settings.ep_webrtc.video) {
    videoDisabled = settings.ep_webrtc.video.disabled;
  }

  context.content += eejs.require('./templates/settings.ejs', {
    enabled,
    audio_hard_disabled: audioDisabled === 'hard',
    video_hard_disabled: videoDisabled === 'hard',
  }, module);
  callback();
};

exports.eejsBlock_editorContainerBox = (hook_name, args, cb) => {
  args.content += eejs.require('./templates/webrtc.ejs', {}, module);
  return cb();
};

exports.eejsBlock_styles = (hook_name, args, cb) => {
  args.content += eejs.require('./templates/styles.html', {}, module);
  return cb();
};

const validateSettings = () => {
  if (settings.ep_webrtc && settings.ep_webrtc.audio && settings.ep_webrtc.audio.disabled) {
    if (
      settings.ep_webrtc.audio.disabled !== 'none' &&
      settings.ep_webrtc.audio.disabled !== 'hard' &&
      settings.ep_webrtc.audio.disabled !== 'soft'
    ) {
      configLogger.error('Invalid value in settings.json for ep_webrtc.audio.disabled');
      return false;
    }
  }

  if (settings.ep_webrtc && settings.ep_webrtc.video && settings.ep_webrtc.video.disabled) {
    if (
      settings.ep_webrtc.video.disabled !== 'none' &&
      settings.ep_webrtc.video.disabled !== 'hard' &&
      settings.ep_webrtc.video.disabled !== 'soft'
    ) {
      configLogger.error('Invalid value in settings.json for ep_webrtc.video.disabled');
      return false;
    }
  }
  return true;
};
