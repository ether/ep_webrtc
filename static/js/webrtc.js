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

// Toggles the enabled state of the first track, then updates the other tracks to match. Returns
// true iff the result is no enabled tracks (either there are no tracks or all tracks are muted).
const toggleTracks = (tracks) => {
  const [{enabled: enabledBefore = true} = {}] = tracks;
  const enabledAfter = !enabledBefore;
  for (const track of tracks) track.enabled = enabledAfter;
  return !enabledAfter; // Return true iff disabled (muted).
};

exports.rtc = new class {
  constructor() {
    this._settings = null;
    this._isActive = false;
    this._localStream = null;
    this._pc = {};
  }

  // API HOOKS

  async postAceInit(hookName, {pad}) {
    this._settings = clientVars.webrtc;
    if (this._settings == null || this._settings.configError) {
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
      audio: this._settings.audio.disabled !== 'hard',
      video: this._settings.video.disabled !== 'hard' && {width: {max: 320}, height: {max: 240}},
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
    for (const track of stream.getAudioTracks()) {
      track.enabled = !!$('#options-audioenabledonstart').prop('checked');
    }
    for (const track of stream.getVideoTracks()) {
      track.enabled = !!$('#options-videoenabledonstart').prop('checked');
    }

    this._localStream = stream;
    this.setStream(this._pad.getUserId(), stream);
    this.hangupAll();
    await Promise.all(this._pad.collabClient.getConnectedUsers().map(async (user) => {
      if (user.userId === this.getUserId()) return;
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
    return this._localStream == null || toggleTracks(this._localStream.getAudioTracks());
  }

  toggleVideo() {
    return this._localStream == null || toggleTracks(this._localStream.getVideoTracks());
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
    const videoId = `video_${userId.replace(/\./g, '_')}`;
    let $video = $(`#${videoId}`);
    if (!stream) {
      $video.parent().remove();
      return;
    }
    if ($video.length === 0) {
      $video = this.addInterface(userId, stream);
    }
    // Avoid flicker by checking if .srcObject already equals stream.
    if ($video[0].srcObject !== stream) $video[0].srcObject = stream;
  }

  addInterface(userId, stream) {
    const isLocal = userId === this.getUserId();
    const videoId = `video_${userId.replace(/\./g, '_')}`;
    const size = `${this._settings.video.sizes.small}px`;
    const $video = $('<video>')
        .attr({
          id: videoId,
          playsinline: '',
          autoplay: '',
          muted: isLocal ? '' : null,
        })
        .prop('muted', isLocal) // Setting the 'muted' attribute isn't sufficient for some reason.
        .css({'width': size, 'max-height': size});
    const $interface = $('<div>')
        .addClass('interface-container')
        .attr('id', `interface_${videoId}`);
    $('#rtcbox').append(
        $('<div>')
            .addClass('video-container')
            .toggleClass('local-user', isLocal)
            .css({'width': size, 'max-height': size})
            .append($('<div>').addClass('user-name'))
            .append($video)
            .append($interface));
    this.updatePeerNameAndColor(this.getUserFromId(userId));

    // /////
    // Mute button
    // /////

    const audioHardDisabled = this._settings.audio.disabled === 'hard';
    const hasAudio = stream.getAudioTracks().some((t) => t.enabled);
    $interface.append($('<span>')
        .addClass('interface-btn audio-btn buttonicon')
        .attr('title',
            audioHardDisabled ? 'Audio disallowed by admin'
            : hasAudio ? 'Mute'
            : 'Unmute')
        .toggleClass('muted', !hasAudio || audioHardDisabled)
        .toggleClass('disallowed', audioHardDisabled)
        .on(audioHardDisabled ? {} : {
          click: (event) => {
            const muted = isLocal ? this.toggleMuted() : ($video[0].muted = !$video[0].muted);
            $(event.currentTarget)
                .attr('title', muted ? 'Unmute' : 'Mute')
                .toggleClass('muted', muted);
          },
        }));

    // /////
    // Disable Video button
    // /////

    if (isLocal) {
      const videoHardDisabled = this._settings.video.disabled === 'hard';
      const hasVideo = stream.getVideoTracks().some((t) => t.enabled);
      $interface.append($('<span>')
          .addClass('interface-btn video-btn buttonicon')
          .attr('title',
              videoHardDisabled ? 'Video disallowed by admin'
              : hasVideo ? 'Disable video'
              : 'Enable video')
          .toggleClass('off', !hasVideo || videoHardDisabled)
          .toggleClass('disallowed', videoHardDisabled)
          .on(videoHardDisabled ? {} : {
            click: (event) => {
              const videoEnabled = !this.toggleVideo();
              $(event.currentTarget)
                  .attr('title', videoEnabled ? 'Disable video' : 'Enable video')
                  .toggleClass('off', !videoEnabled);
            },
          }));
    }

    // /////
    // Enlarge Video button
    // /////

    let videoEnlarged = false;
    $interface.append($('<span>')
        .addClass('interface-btn enlarge-btn buttonicon')
        .attr('title', 'Make video larger')
        .on({
          click: (event) => {
            videoEnlarged = !videoEnlarged;
            $(event.currentTarget)
                .attr('title', videoEnlarged ? 'Make video smaller' : 'Make video larger')
                .toggleClass('large', videoEnlarged);
            const videoSize = `${this._settings.video.sizes[videoEnlarged ? 'large' : 'small']}px`;
            $video.parent().css({'width': videoSize, 'max-height': videoSize});
            $video.css({'width': videoSize, 'max-height': videoSize});
          },
        }));

    return $video;
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
    this._pc[userId] = new RTCPeerConnection({iceServers: this._settings.iceServers});
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
    const urlValue = (new URLSearchParams(window.location.search)).get(params.urlVar);

    // * If the setting is in the URL: use it, and also set the cookie
    // * If the setting is not in the URL: try to get it from the cookie
    // * If the setting was in neither, go with the site-wide default value
    //   but don't put it in the cookies
    if (['YES', 'true'].includes(urlValue)) { // 'YES' is for backward compatibility with av=YES.
      padcookie.setPref(params.cookie, true);
      value = true;
    } else if (['NO', 'false'].includes(urlValue)) { // 'NO' for symmetry with deprecated av=YES.
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

  async init(pad) {
    this._pad = pad;

    this.settingToCheckbox({
      urlVar: 'av',
      cookie: 'rtcEnabled',
      defaultVal: this._settings.enabled,
      checkboxId: '#options-enablertc',
    });

    // The checkbox shouldn't even exist if audio is not allowed
    if (this._settings.audio.disabled !== 'hard') {
      this.settingToCheckbox({
        urlVar: 'webrtcaudioenabled',
        cookie: 'audioEnabledOnStart',
        defaultVal: this._settings.audio.disabled === 'none',
        checkboxId: '#options-audioenabledonstart',
      });
    }

    // The checkbox shouldn't even exist if video is not allowed
    if (this._settings.video.disabled !== 'hard') {
      this.settingToCheckbox({
        urlVar: 'webrtcvideoenabled',
        cookie: 'videoEnabledOnStart',
        defaultVal: this._settings.video.disabled === 'none',
        checkboxId: '#options-videoenabledonstart',
      });
    }

    if (this._settings.listenClass) {
      $(this._settings.listenClass).on('click', async () => {
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
    $(window).on('beforeunload', () => { this.hangupAll(); });
    $(window).on('unload', () => { this.hangupAll(); });
    if ($('#options-enablertc').prop('checked')) {
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
