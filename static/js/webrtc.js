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
'use strict';

require('./adapter');
const padcookie = require('ep_etherpad-lite/static/js/pad_cookie').padcookie;

exports.rtc = new class {
  constructor() {
    this._videoSizes = {large: '260px', small: '160px'};
    this._isActive = false;
    this._pcConfig = {};
    this._localStream = null;
    this._pc = {};
  }

  // API HOOKS

  async postAceInit(hookName, {pad}) {
    if (clientVars.webrtc == null || clientVars.webrtc.configError) {
      $.gritter.add({
        title: 'Error',
        text: 'Ep_webrtc: There is an error with the configuration of this plugin. Please ' +
            'inform the administrators of this site. They will see the details in their logs.',
        sticky: true,
        class_name: 'error',
      });
      return;
    }
    if (!$('#editorcontainerbox').hasClass('flex-layout')) {
      $.gritter.add({
        title: 'Error',
        text: 'Ep_webrtc: Please upgrade to etherpad 1.8.3 for this plugin to work correctly',
        sticky: true,
        class_name: 'error',
      });
    }
    this._pcConfig.iceServers = clientVars.webrtc && clientVars.webrtc.iceServers
      ? clientVars.webrtc.iceServers
      : [{urls: ['stun:stun.l.google.com:19302']}];
    if (clientVars.webrtc.video.sizes.large) {
      this._videoSizes.large = `${clientVars.webrtc.video.sizes.large}px`;
    }
    if (clientVars.webrtc.video.sizes.small) {
      this._videoSizes.small = `${clientVars.webrtc.video.sizes.small}px`;
    }
    await this.init(pad);
  }

  userJoinOrUpdate(hookName, {userInfo}) {
    this.updatePeerNameAndColor(userInfo);
  }

  userLeave(hookName, {userInfo: {userId}}) {
    this.hangup(userId, false);
  }

  handleClientMessage_RTC_MESSAGE(hookName, {payload}) {
    if (this._isActive) this.receiveMessage(payload);
    return [null];
  }

  // END OF API HOOKS

  updatePeerNameAndColor(userInfo) {
    if (!userInfo) return;
    const {userId, name = html10n.get('pad.userlist.unnamed'), colorId = 0} = userInfo;
    const color = typeof colorId === 'number' ? clientVars.colorPalette[colorId] : colorId;
    $(`#video_${userId.replace(/\./g, '_')}`)
        .css({'border-color': color})
        .siblings('.user-name').text(name);
  }

  showUserMediaError(err) { // show an error returned from getUserMedia
    let reason;
    // For reference on standard errors returned by getUserMedia:
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
    switch (err.name) {
      case 'NotAllowedError':
        // For certain (I suspect older) browsers, `NotAllowedError` indicates either an
        // insecure connection or the user rejecting camera permissions.
        // The error for both cases appears to be identical, so our best guess at telling
        // them apart is to guess whether we are in a secure context.
        // (webrtc is considered secure for https connections or on localhost)
        if (location.protocol === 'https:' ||
            location.hostname === 'localhost' ||
            location.hostname === '127.0.0.1') {
          reason = html10n.get('pad.ep_webrtc.error.permission');
          this.sendErrorStat('Permission');
        } else {
          reason = html10n.get('pad.ep_webrtc.error.ssl');
          this.sendErrorStat('SecureConnection');
        }
        break;
      case 'NotFoundError':
        reason = html10n.get('pad.ep_webrtc.error.notFound');
        this.sendErrorStat('NotFound');
        break;
      case 'NotReadableError':
        // `err.message` might give useful info to the user (not necessarily
        // useful for other error messages)
        reason = $('<div>')
            .append($('<p>').text(html10n.get('pad.ep_webrtc.error.notReadable')))
            .append($('<p>').text(err.message));
        this.sendErrorStat('Hardware');
        break;
      case 'AbortError':
        // `err.message` might give useful info to the user (not necessarily useful for
        // other error messages)
        reason = $('<div>')
            .append($('<p>').text(html10n.get('pad.ep_webrtc.error.otherCantAccess')))
            .append($('<p>').text(err.message));
        this.sendErrorStat('Abort');
        break;
      default:
        // Let Etherpad's error handling handle the error.
        throw err;
    }
    $.gritter.add({
      title: 'Error',
      text: reason,
      sticky: true,
      class_name: 'error',
    });
  }

  async activate() {
    $('#options-enablertc').prop('checked', true);
    if (this._isActive) return;
    $('#rtcbox').css('display', 'flex');
    padcookie.setPref('rtcEnabled', true);
    this._isActive = true;
    const constraints = {
      audio: clientVars.webrtc.audio.disabled !== 'hard',
      video: clientVars.webrtc.video.disabled !== 'hard' && {width: {max: 320}, height: {max: 240}},
    };
    if (padcookie.getPref('fakeWebrtcFirefox')) {
      // The equivalent is done for chromium with cli option:
      // --use-fake-device-for-media-stream
      constraints.fake = true;
    }
    let stream = new MediaStream();
    if (constraints.audio || constraints.video) {
      try {
        stream = await window.navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        try {
          this.showUserMediaError(err);
        } finally {
          this.deactivate();
        }
        return;
      }
    }
    // Disable audio and/or video according to user/site settings.
    // Do this before setting `this._localStream` to avoid a race condition
    // that might flash the video on for an instant before disabling it.
    const audioTrack = stream.getAudioTracks()[0];
    // using `.prop("checked") === true` to make absolutely sure the result is a boolean
    // we don't want bugs when it comes to muting/turning off video
    if (audioTrack) {
      audioTrack.enabled = $('#options-audioenabledonstart').prop('checked') === true;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = $('#options-videoenabledonstart').prop('checked') === true;
    }

    this._localStream = stream;
    this.setStream(this._pad.getUserId(), stream);
    await Promise.all(this._pad.collabClient.getConnectedUsers().map(async (user) => {
      if (user.userId === this.getUserId()) return;
      if (this._pc[user.userId]) this.hangup(user.userId);
      await this.call(user.userId);
    }));
  }

  deactivate() {
    $('#options-enablertc').prop('checked', false);
    if (!this._isActive) return;
    $('#rtcbox').hide();
    padcookie.setPref('rtcEnabled', false);
    this.hangupAll();
    if (this._localStream) {
      this.setStream(this._pad.getUserId(), null);
      for (const track of this._localStream.getTracks()) track.stop();
      this._localStream = null;
    }
    this._isActive = false;
  }

  toggleMuted() {
    const audioTrack = this._localStream.getAudioTracks()[0];
    if (!audioTrack) return true; // if there's no audio track, it's muted
    audioTrack.enabled = !audioTrack.enabled;
    return !audioTrack.enabled; // returning "Muted" state, which is !enabled
  }

  toggleVideo() {
    const videoTrack = this._localStream.getVideoTracks()[0];
    if (!videoTrack) return true; // if there's no video track, it's disabled
    videoTrack.enabled = !videoTrack.enabled;
    return !videoTrack.enabled; // returning whether it's disabled, to match toggleMuted
  }

  getUserFromId(userId) {
    if (!this._pad || !this._pad.collabClient) return null;
    const result = this._pad.collabClient
        .getConnectedUsers()
        .filter((user) => user.userId === userId);
    const user = result.length > 0 ? result[0] : null;
    return user;
  }

  setStream(userId, stream) {
    const isLocal = userId === this.getUserId();
    const videoId = `video_${userId.replace(/\./g, '_')}`;
    let video = $(`#${videoId}`)[0];

    if (!video && stream) {
      const size = this._videoSizes.small;
      const videoContainer = $("<div class='video-container'>")
          .css({'width': size, 'max-height': size})
          .appendTo($('#rtcbox'));

      videoContainer.append($('<div class="user-name">'));

      video = $('<video playsinline>')
          .attr('id', videoId)
          .css({'width': size, 'max-height': size})
          .appendTo(videoContainer)[0];

      video.autoplay = true;
      if (isLocal) {
        videoContainer.addClass('local-user');
        video.muted = true;
      }
      this.addInterface(userId, stream);
      this.updatePeerNameAndColor(this.getUserFromId(userId));
    }
    if (stream) {
      // Avoid flicker by checking if .srcObject already equals stream.
      if (video.srcObject !== stream) video.srcObject = stream;
    } else if (video) {
      $(video).parent().remove();
    }
  }

  addInterface(userId, stream) {
    const isLocal = userId === this.getUserId();
    const videoId = `video_${userId.replace(/\./g, '_')}`;
    const $video = $(`#${videoId}`);

    // /////
    // Mute button
    // /////

    const audioTrack = stream.getAudioTracks()[0];
    const audioHardDisabled = clientVars.webrtc.audio.disabled === 'hard';
    let initiallyMuted = true; // if there's no audio track, it's muted
    if (audioTrack) initiallyMuted = !audioTrack.enabled;

    const $mute = $("<span class='interface-btn audio-btn buttonicon'>")
        .attr('title',
            audioHardDisabled ? 'Audio disallowed by admin'
            : initiallyMuted ? 'Unmute'
            : 'Mute')
        .toggleClass('muted', initiallyMuted || audioHardDisabled)
        .toggleClass('disallowed', audioHardDisabled);

    if (!audioHardDisabled) {
      $mute.on({
        click: (event) => {
          let muted;
          if (isLocal) {
            muted = this.toggleMuted();
          } else {
            $video[0].muted = !$video[0].muted;
            muted = $video[0].muted;
          }
          $mute
              .attr('title', muted ? 'Unmute' : 'Mute')
              .toggleClass('muted', muted);
        },
      });
    }

    // /////
    // Disable Video button
    // /////

    let $disableVideo = null;
    if (isLocal) {
      const videoTrack = stream.getVideoTracks()[0];
      const videoHardDisabled = clientVars.webrtc.video.disabled === 'hard';
      let initiallyVideoEnabled = false; // if there's no video track, it's disabled
      if (videoTrack) {
        initiallyVideoEnabled = videoTrack.enabled;
      }
      $disableVideo = $("<span class='interface-btn video-btn buttonicon'>")
          .attr('title',
              videoHardDisabled ? 'Video disallowed by admin'
              : initiallyVideoEnabled ? 'Disable video'
              : 'Enable video')
          .toggleClass('off', !initiallyVideoEnabled || videoHardDisabled)
          .toggleClass('disallowed', videoHardDisabled);
      if (!videoHardDisabled) {
        $disableVideo.on({
          click: (event) => {
            const videoEnabled = !this.toggleVideo();
            $disableVideo
                .attr('title', videoEnabled ? 'Disable video' : 'Enable video')
                .toggleClass('off', !videoEnabled);
          },
        });
      }
    }

    // /////
    // Enlarge Video button
    // /////

    let videoEnlarged = false;
    const $largeVideo = $("<span class='interface-btn enlarge-btn buttonicon'>")
        .attr('title', 'Make video larger')
        .on({
          click: (event) => {
            videoEnlarged = !videoEnlarged;
            $largeVideo
                .attr('title', videoEnlarged ? 'Make video smaller' : 'Make video larger')
                .toggleClass('large', videoEnlarged);
            const videoSize = videoEnlarged ? this._videoSizes.large : this._videoSizes.small;
            $video.parent().css({'width': videoSize, 'max-height': videoSize});
            $video.css({'width': videoSize, 'max-height': videoSize});
          },
        });


    // /////
    // Combining
    // /////

    $("<div class='interface-container'>")
        .attr('id', `interface_${videoId}`)
        .append($mute)
        .append($disableVideo)
        .append($largeVideo)
        .insertAfter($video);
  }

  // Sends a stat to the back end. `statName` must be in the
  // approved list on the server side.
  sendErrorStat(statName) {
    const msg = {
      component: 'pad',
      type: 'STATS',
      data: {statName, type: 'RTC_MESSAGE'},
    };
    this._pad.socket.json.send(msg);
  }

  sendMessage(to, data) {
    this._pad.collabClient.sendMessage({
      type: 'RTC_MESSAGE',
      payload: {data, to},
    });
  }

  async receiveMessage(msg) {
    const peer = msg.from;
    const data = msg.data;
    const type = data.type;
    if (peer === this.getUserId()) return;
    if (type === 'hangup') {
      this.hangup(peer, false);
    } else if (type === 'offer') {
      if (this._pc[peer]) this.hangup(peer, false);
      this.createPeerConnection(peer);
      if (this._localStream && !this._pc[peer].getSenders().length) {
        for (const track of this._localStream.getTracks()) {
          this._pc[peer].addTrack(track, this._localStream);
        }
      }
      await this._pc[peer].setRemoteDescription(data.offer);
      await this._pc[peer].setLocalDescription();
      this.sendMessage(peer, {type: 'answer', answer: this._pc[peer].localDescription});
    } else if (type === 'answer') {
      if (this._pc[peer]) await this._pc[peer].setRemoteDescription(data.answer);
    } else if (type === 'icecandidate') {
      if (this._pc[peer] && data.candidate) await this._pc[peer].addIceCandidate(data.candidate);
    } else {
      console.log('unknown message', data);
    }
  }

  hangupAll() {
    Object.keys(this._pc).forEach((userId) => {
      this.hangup(userId);
    });
  }

  getUserId() {
    return this._pad.getUserId();
  }

  hangup(userId, notify = true) {
    if (!this._pc[userId]) return;
    this.setStream(userId, null);
    this._pc[userId].close();
    delete this._pc[userId];
    if (notify) this.sendMessage(userId, {type: 'hangup'});
  }

  async call(userId) {
    if (!this._localStream) return;
    if (!this._pc[userId]) this.createPeerConnection(userId);
    for (const track of this._localStream.getTracks()) {
      this._pc[userId].addTrack(track, this._localStream);
    }
    await this._pc[userId].setLocalDescription();
    this.sendMessage(userId, {type: 'offer', offer: this._pc[userId].localDescription});
  }

  createPeerConnection(userId) {
    if (this._pc[userId]) {
      console.log('WARNING creating PC connection even though one exists', userId);
    }
    this._pc[userId] = new RTCPeerConnection(this._pcConfig);
    this._pc[userId].onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendMessage(userId, {
        type: 'icecandidate',
        candidate: event.candidate,
      });
    };
    let stream = null;
    this._pc[userId].addEventListener('track', (e) => {
      if (e.streams.length !== 1) throw new Error('Expected track to be in exactly one stream');
      const trackStream = e.streams[0];
      if (stream == null) {
        stream = trackStream;
        stream.addEventListener('removetrack', (e) => {
          if (stream !== trackStream) throw new Error('removetrack event for old stream');
          if (stream.getTracks().length > 0) return;
          stream = null;
          this.setStream(userId, null);
        });
        this.setStream(userId, stream);
      } else if (stream !== trackStream) {
        throw new Error('New track associated with unexpected stream');
      }
    });
  }

  avInURL() {
    return window.location.search.includes('av=YES');
  }

  // Connect a setting to a checkbox. To be called on initialization.
  //
  // It will check for the value in urlVar, cookie, and the site-wide
  //   default value, in that order
  // If urlVar is found, it will also set the cookie
  // Finally, it sets up to set cookie if the user changes the setting in the gearbox
  settingToCheckbox(params) {
    for (const prop of ['checkboxId', 'cookie', 'defaultVal', 'urlVar']) {
      if (params[prop] == null) throw new Error(`missing ${prop} in settingToCheckbox`);
    }

    let value;

    // * If the setting is in the URL: use it, and also set the cookie
    // * If the setting is not in the URL: try to get it from the cookie
    // * If the setting was in neither, go with the site-wide default value
    //   but don't put it in the cookies
    if (window.location.search.includes(`${params.urlVar}=true`)) {
      padcookie.setPref(params.cookie, true);
      value = true;
    } else if (window.location.search.includes(`${params.urlVar}=false`)) {
      padcookie.setPref(params.cookie, false);
      value = false;
    } else {
      value = padcookie.getPref(params.cookie);
      if (typeof value === 'undefined') {
        value = params.defaultVal;
      }
    }

    $(params.checkboxId).prop('checked', value);

    // If the user changes the checkbox, set the cookie accordingly
    $(params.checkboxId).on('change', function () {
      padcookie.setPref(params.cookie, this.checked);
    });
  }

  setupCheckboxes() {
    // The checkbox shouldn't even exist if audio is not allowed
    if (clientVars.webrtc.audio.disabled !== 'hard') {
      this.settingToCheckbox({
        urlVar: 'webrtcaudioenabled',
        cookie: 'audioEnabledOnStart',
        defaultVal: clientVars.webrtc.audio.disabled === 'none',
        checkboxId: '#options-audioenabledonstart',
      });
    }

    // The checkbox shouldn't even exist if video is not allowed
    if (clientVars.webrtc.video.disabled !== 'hard') {
      this.settingToCheckbox({
        urlVar: 'webrtcvideoenabled',
        cookie: 'videoEnabledOnStart',
        defaultVal: clientVars.webrtc.video.disabled === 'none',
        checkboxId: '#options-videoenabledonstart',
      });
    }
  }

  async init(pad) {
    this._pad = pad;

    this.setupCheckboxes();

    // TODO - add this to setupCheckboxes. it's a bit involved.
    let rtcEnabled = padcookie.getPref('rtcEnabled');
    if (typeof rtcEnabled === 'undefined') rtcEnabled = $('#options-enablertc').prop('checked');
    if (this.avInURL()) rtcEnabled = true;

    if (clientVars.webrtc.listenClass) {
      $(clientVars.webrtc.listenClass).on('click', async () => {
        await this.activate();
      });
    }
    $('#options-enablertc').on('change', async (event) => {
      if (event.currentTarget.checked) {
        await this.activate();
      } else {
        this.deactivate();
      }
    });
    if (this._isActive) {
      $(window).on('unload', () => {
        this.hangupAll();
      });
    }
    if (rtcEnabled) {
      await this.activate();
    } else {
      this.deactivate();
    }
    $('#rtcbox').data('initialized', true); // Help tests determine when init() is done.
  }
}();

for (const hookFn of [
  'handleClientMessage_RTC_MESSAGE',
  'postAceInit',
  'userJoinOrUpdate',
  'userLeave',
]) {
  exports[hookFn] = exports.rtc[hookFn].bind(exports.rtc);
}

// Access to do some unit tests. If there's a more formal way to do this for all plugins,
// we can change to that.
window.ep_webrtc = exports.rtc;
