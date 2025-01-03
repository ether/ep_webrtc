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

let enableDebugLogging = false;
const debug = (...args) => { if (enableDebugLogging) console.debug('ep_webrtc:', ...args); };

const EventTargetPolyfill = (() => {
  try {
    new class extends EventTarget { constructor() { super(); } }();
    return EventTarget;
  } catch (err) {
    debug('Browser does not support extending EventTarget, using a workaround. Error:', err);
    // Crude, but works well enough.
    return class {
      constructor() {
        const delegate = document.createDocumentFragment();
        for (const fn of ['addEventListener', 'dispatchEvent', 'removeEventListener']) {
          this[fn] = (...args) => delegate[fn](...args);
        }
      }
    };
  }
})();

// Used to help remote peers detect when this user reloads the page.
const sessionId = Date.now();
// Incremented each time a new RTCPeerConnection is created.
let nextInstanceId = 0;

const logErrorToServer = async (err, delay = 10000) => {
  // Sleep to avoid logging benign errors caused by the user leaving the page (e.g., audio/video
  // stream ended unexpectedly). If the user navigates away during this sleep the error will not
  // be logged.
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  // Mimick Etherpad core's global exception handler in pad_utils.js.
  const {message = 'unknown', fileName = 'unknown', lineNumber = -1} = err;
  let msg = message;
  if (err.name != null && msg !== err.name && !msg.startsWith(`${err.name}: `)) {
    msg = `${err.name}: ${msg}`;
  }
  await $.post('../jserror', {
    errorInfo: JSON.stringify(Object.assign({
      type: 'Plugin ep_webrtc',
      msg,
      url: window.location.href,
      source: fileName,
      linenumber: lineNumber,
      userAgent: navigator.userAgent,
      stack: err.stack,
    }, err.peerMessage == null ? {} : {peerMessage: err.peerMessage})),
  });
};

class Mutex {
  async lock() {
    while (this._locked != null) await this._locked;
    this._locked = new Promise((resolve) => this._unlock = resolve);
  }

  unlock() {
    this._unlock();
    this._locked = null;
  }
}

class LocalTracks extends EventTargetPolyfill {
  constructor() {
    super();
    Object.defineProperty(this, 'stream', {value: new MediaStream(), writeable: false});
    this.videoIsScreenshare = false;
  }

  getTracks(kind) {
    return kind === 'audio' ? this.stream.getAudioTracks()
      : kind === 'video' ? this.stream.getVideoTracks()
      : this.stream.getTracks();
  }

  setTrack(kind, newTrack) {
    newTrack = newTrack || null; // Convert undefined to null.
    let oldTrack = null;
    const tracks = this.getTracks(kind);
    for (const track of tracks) {
      if (track.kind !== kind) continue;
      if (track === newTrack) return; // No change.
      oldTrack = track;
      debug(`removing ${kind} track ${oldTrack.id} from local stream`);
      this.stream.removeTrack(oldTrack);
      break;
    }
    if (newTrack != null) {
      debug(`adding ${kind} track ${newTrack.id} to local stream`);
      newTrack.addEventListener('ended', () => {
        debug(`local ${kind} track ${newTrack.id} ended`);
        if (!this.getTracks(kind).includes(newTrack)) return;
        this.setTrack(kind, null);
      });
      this.stream.addTrack(newTrack);
    }
    this.dispatchEvent(Object.assign(new CustomEvent('trackchanged'), {oldTrack, newTrack}));
    if (oldTrack != null) {
      debug(`stopping ${kind} track ${oldTrack.id}`);
      oldTrack.stop();
    }
  }
}

class StreamEvent extends CustomEvent {
  constructor(type, stream) {
    super(type, {detail: stream});
    this.stream = stream;
  }
}

class ClosedEvent extends CustomEvent {
  constructor() {
    super('closed');
  }
}

// Events:
//   * 'stream' (see StreamEvent): Emitted when the remote stream is ready. For every 'stream' event
//     there will be a corresponding 'streamgone' event. Once a stream is added another stream will
//     not be added until after the original stream is removed.
//   * 'streamgone' (see StreamEvent): Emitted when the remote stream goes away, including when the
//     PeerState is closed.
//   * 'closed' (see ClosedEvent): Emitted when the PeerState is closed, except when closed by a
//     call to close(). The PeerState must not be used after it is closed.
class PeerState extends EventTargetPolyfill {
  constructor(pcConfig, caller, sendMessage, localTracks, debug) {
    super();
    this._pcConfig = pcConfig;
    this._caller = caller;
    this._sendMessage = (msg) => sendMessage(Object.assign({ids: this._ids}, msg));
    this._localTracks = localTracks;
    this._failedSLDAttempts = 0;
    this._debug = debug;
    this._debug(`I am the ${this._caller ? 'calling' : 'answering'} peer`);
    this._ids = {
      from: {
        // Only changes when the user reloads the page.
        session: sessionId,
        // Increased when WebRTC renegotiation is necessary due to an error.
        instance: 0,
      },
    };
    this._closed = false;
    this._pc = null;
    this._xcvrs = {};
    this._remoteStream = null;
    this._ontrackchanged = async ({oldTrack, newTrack}) => {
      const {kind} = oldTrack || newTrack;
      await this._sendLocalTrack(kind, newTrack);
    };
    this._localTracks.addEventListener('trackchanged', this._ontrackchanged);
  }

  async _sendLocalTrack(kind, track) {
    if (this._pc == null || this._pc.connectionState === 'closed') return;
    const {sender: {track: old} = {}} = this._xcvrs[kind] || {};
    if ((old == null && track == null) || old === track) return;
    this._debug(
        `replacing ${kind} track ${old ? old.id : '(null)'} with ${track ? track.id : '(null)'}`);
    const xcvr = this._xcvrs[kind];
    if (!xcvr) return;
    try {
      if (track != null) xcvr.direction = 'sendrecv'; // Will throw if not already bidirectional.
      await xcvr.sender.replaceTrack(track);
    } catch (err) {
      this._debug('renegotiation is required');
      this._resetConnection(err);
      return;
    }
  }

  _setRemoteStream(stream) {
    if (stream === this._remoteStream) return;
    if (this._remoteStream != null) {
      const oldStream = this._remoteStream;
      this._remoteStream = null;
      this.dispatchEvent(new StreamEvent('streamgone', oldStream));
    }
    if (stream != null) {
      this._remoteStream = stream;
      this.dispatchEvent(new StreamEvent('stream', stream));
    }
  }

  _resetConnection(err = null, peerIds = null) {
    if (err != null) {
      this._debug('resetting connection due to error:', err);
      logErrorToServer(err);
    }
    if (this._closed) {
      this._debug('ignoring _resetConnection() on closed PeerState');
      return;
    }
    this._debug('creating RTCPeerConnection with config', this._pcConfig);
    this._debug('peer IDs:', peerIds);
    this._setRemoteStream(null);
    this._ids.from.instance = ++nextInstanceId;
    this._ids.to = peerIds;
    const pc = new RTCPeerConnection(this._pcConfig);
    pc.addEventListener('track', async ({track, transceiver}) => {
      this._debug(`Received ${track.kind} track from peer, ID: ${track.id}`);
      const stream = this._remoteStream || new MediaStream();
      stream.addTrack(track);
      this._setRemoteStream(stream);
      if (!this._caller) {
        this._xcvrs[track.kind] = transceiver;
        // _sendLocalTrack might call _resetConnection, so it should be called last.
        await this._sendLocalTrack(track.kind, this._localTracks.getTracks(track.kind)[0]);
      }
    });
    pc.addEventListener('icecandidate', ({candidate}) => this._sendMessage({candidate}));
    pc.addEventListener('negotiationneeded', async () => {
      try {
        await pc.setLocalDescription();
        this._failedSLDAttempts = 0;
        this._sendMessage({description: pc.localDescription});
      } catch (err) {
        console.error('Error setting local description:', err);
        if (++this._failedSLDAttempts > 10) throw err; // Avoid an infinite loop.
        this._resetConnection(err);
        return;
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      this._debug(`connection state changed to ${pc.connectionState}`);
      switch (pc.connectionState) {
        case 'closed':
          this._resetConnection(new Error('connectionState changed to closed'));
          break;
        case 'connected':
          if (this._remoteStream == null) this._setRemoteStream(this._disconnectedRemoteStream);
          break;
        case 'disconnected':
          // Unfortunately, if the peer reconnects later there might not be a track event that can
          // be used to re-add the stream. Stash the stream so that it can be reused on reconnect.
          this._disconnectedRemoteStream = this._remoteStream;
          this._setRemoteStream(null);
          break;
        // From reading the spec it is not clear what the possible state transitions are, but it
        // seems that on at least Chrome 90 the 'failed' state is terminal (it can never go back to
        // working) so a new RTCPeerConnection must be made.
        case 'failed':
          this._resetConnection(new Error('connectionState changed to failed'));
          break;
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      this._debug(`ICE connection state changed to ${pc.iceConnectionState}`);
      switch (pc.iceConnectionState) {
        case 'failed':
          // Chrome 65 and other old browsers don't have pc.restartIce(). Ignore the failure on
          // those browsers; the connection state should transition to failed which will trigger a
          // call to this._resetConnection().
          if (typeof pc.restartIce === 'function') pc.restartIce();
          break;
      }
    });
    // RTCPeerConnection.peerIdentity is mentioned in https://www.w3.org/TR/webrtc-identity/ but as
    // of 2021-06-24 only Firefox supports it.
    if (pc.peerIdentity != null) {
      // Silence "InvalidStateError: RTCPeerConnection is gone (did you enter Offline mode?)"
      // unhandled Promise rejection errors in Firefox. This can happen if Firefox drops the
      // connection because the pad is in an idle/background tab.
      pc.peerIdentity.catch((err) => this._debug('Failed to assert peer identity:', err));
    }

    if (this._pc != null) this._pc.close();
    this._pc = pc;
    this._xcvrs = {};

    if (this._caller) {
      // Adding transceivers triggers negotiation with the peer, which we want to do as soon as
      // possible to warm up the peer connection (ICE takes a while). Adding a track implicitly adds
      // a transceiver so we could do that instead, but:
      //
      //   * We might not have a local track yet (maybe the user hasn't yet allowed access to the
      //     camera/mic).
      //   * Using a dummy silence track until a real track is ready might result in two
      //     unidirectional SDP m-lines (one in each direction) instead of a single bidirectional
      //     m-line. This seems to trigger an echo bug in Safari.
      //
      // Using transceivers to warm up the connection is the approach taken in:
      // https://www.w3.org/TR/2021/REC-webrtc-20210126/#advanced-peer-to-peer-example-with-warm-up
      // Also see: https://webrtcstandards.info/ice-warm-up-m-line-webrtc-transceivers/
      Promise.all(['audio', 'video'].map(async (t) => {
        this._debug(`adding ${t} transceiver`);
        this._xcvrs[t] = this._pc.addTransceiver(t);
        await this._sendLocalTrack(t, this._localTracks.getTracks(t)[0]);
      }));
    } else {
      // It is possible that the last invite sent to the peer was sent before the peer was ready to
      // accept invites, so the peer might not know that it should call now. Send another invite
      // just in case. The peer will ignore any superfluous invites.
      this._sendMessage({invite: 'invite'});
    }
  }

  async receiveMessage(msg) {
    if (this._closed) return this._debug('Ignoring message because PeerState is closed');
    const {ids, candidate, description, hangup} = msg;
    if (hangup != null) {
      this.close(true);
      return;
    }
    if (ids != null) {
      const {
        session: wantSession = this._ids.from.session,
        instance: wantInstance = this._ids.from.instance,
      } = ids.to || {};
      if (wantSession !== this._ids.from.session || wantInstance !== this._ids.from.instance) {
        this._debug('dropping message intended for a different instance');
        this._debug('current IDs:', this._ids.from);
        return;
      }
      for (const idType of ['session', 'instance']) {
        const newId = (ids.from || {})[idType];
        const currentId = (this._ids.to || {})[idType];
        if (currentId == null || newId === currentId) continue;
        if (newId == null || newId < currentId) return;
        // The remote peer reloaded the page or experienced an error. Destroy and recreate the local
        // RTCPeerConnection to avoid browser quirks caused by state mismatches.
        this._resetConnection(new Error(
            `remote peer forced WebRTC renegotiation via new ${idType} ID ` +
            `(old ID ${currentId}, new ID ${newId})`), ids.from);
        break;
      }
      this._ids.to = ids.from;
    }
    if (this._pc == null) this._resetConnection(null, this._ids.to);
    try {
      if (description != null) {
        await this._pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await this._pc.setLocalDescription();
          this._sendMessage({description: this._pc.localDescription});
        }
      }
      if (candidate != null) await this._pc.addIceCandidate(candidate);
    } catch (err) {
      err.peerMessage = msg;
      console.error('Error processing message from peer:', err);
      this._resetConnection(err);
      return;
    }
  }

  close(emitClosedEvent = false) {
    if (this._closed) return;
    this._closed = true;
    this._localTracks.removeEventListener('trackchanged', this._ontrackchanged);
    if (this._pc != null) this._pc.close();
    this._pc = null;
    this._setRemoteStream(null);
    this._sendMessage({hangup: 'hangup'});
    if (emitClosedEvent) this.dispatchEvent(new ClosedEvent());
  }
}

const isCaller = (myId, otherId) => {
  // Compare user IDs to determine which of the two users will initiate the call.
  const caller = myId.localeCompare(otherId) < 0;
  if ((otherId.localeCompare(myId) < 0) === caller) {
    throw new Error(`Peer ID ${otherId} compares equivalent to own ID ${myId}`);
  }
  return caller;
};

// Periods in element IDs make it hard to build a selector string because period is for class match.
const getVideoId = (userId) => `video_${userId.replace(/\./g, '_')}`;

// Returns the computed width and height in px of the given element.
const getContentSize = (elt) => {
  const {width, height} = window.getComputedStyle(elt);
  return {width: Number.parseFloat(width), height: Number.parseFloat(height)};
};

// Vector dot product.
const dot = (a, b) => a.reduce((acc, n, i) => acc + (1.0 * n * b[i]), 0.0);

exports.rtc = new class {
  constructor() {
    this._activated = null;
    this._settings = null;
    this._localTracks = new LocalTracks();
    this._localTracks.addEventListener('trackchanged', ({oldTrack, newTrack}) => {
      // Normally the self-view UI only needs to be updated if the user clicks on something, but it
      // also needs to be updated if the browser decides to end the local stream for whatever
      // reason. (Safari v14.1 on macOS v11.3.1 (Big Sur) seems to have a bug that causes it to
      // unexpectedly end local streams.)

      // Display an alert if the track went away, or hide the alert if there is a track.
      const $videoContainer = $(`#container_${getVideoId(this.getUserId())}`);
      const {kind} = oldTrack || newTrack;
      $videoContainer.find(`.${kind}ended-error-btn`)
          .css('display', newTrack == null ? '' : 'none');
      if (newTrack == null) logErrorToServer(new Error(`Local ${kind} track ended unexpectedly`));
      ($videoContainer.data('updateMinSize') || (() => {}))();

      // Update the audio/video buttons to reflect the new state.
      if (newTrack != null) return;
      switch (oldTrack.kind) {
        case 'audio': this._selfViewButtons.audio.enabled = false; break;
        case 'video':
          this._selfViewButtons.video.enabled = false;
          this._selfViewButtons.screenshare.enabled = false;
          break;
      }
    });
    this._pad = null;
    this._peers = new Map();
    // Populated with convenience methods once the self-view interface is created.
    this._selfViewButtons = {};
    // When grabbing both locks the audio lock must be grabbed first to avoid deadlock.
    this._trackLocks = {audio: new Mutex(), video: new Mutex()};
  }

  get enableDebugLogging() { return enableDebugLogging; }
  set enableDebugLogging(val) { enableDebugLogging = !!val; }

  // API HOOKS

  async postAceInit(hookName, {pad}) {
    const outerWin = document.querySelector('iframe[name="ace_outer"]').contentWindow;
    const innerWin = outerWin.document.querySelector('iframe[name="ace_inner"]').contentWindow;
    this._windows = [window, outerWin, innerWin];
    this._pad = pad;
    this._settings = clientVars.ep_webrtc;
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
    const $editorcontainerbox = $('#editorcontainerbox');
    if (!$editorcontainerbox.hasClass('flex-layout')) {
      $.gritter.add({
        title: 'Error',
        text: 'Ep_webrtc: Please upgrade to etherpad 1.8.3 for this plugin to work correctly',
        sticky: true,
        class_name: 'error',
      });
    }
    const $rtcbox = $('<div>')
        .attr('id', 'rtcbox')
        .addClass('thin-scrollbar')
        .appendTo($editorcontainerbox);

    this.settingToCheckbox({
      urlVar: 'av',
      cookie: 'rtcEnabled',
      defaultVal: this._settings.enabled,
      checkboxId: '#options-enablertc',
    });
    if (this._settings.audio.disabled !== 'hard') {
      this.settingToCheckbox({
        urlVar: 'webrtcaudioenabled',
        cookie: 'audioEnabledOnStart',
        defaultVal: this._settings.audio.disabled === 'none',
        checkboxId: '#options-audioenabledonstart',
      });
    }
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
        await this.deactivate();
      }
    });
    $(window).on('beforeunload', () => { this.hangupAll(); });
    $(window).on('unload', () => { this.hangupAll(); });
    if ($('#options-enablertc').prop('checked')) {
      await this.activate();
    } else {
      await this.deactivate();
    }
    $rtcbox.data('initialized', true); // Help tests determine when initialization is done.
  }

  userJoinOrUpdate(hookName, {userInfo}) {
    const {userId} = userInfo;
    debug(`(peer ${userId}) join or update`);
    if (!this._activated || !userId) return;
    if (userId !== this.getUserId()) this.invitePeer(userId);
    this.updatePeerNameAndColor(userInfo);
  }

  userLeave(hookName, {userInfo: {userId}}) {
    debug(`(peer ${userId}) leave`);
    this.hangup(userId);
  }

  handleClientMessage_RTC_MESSAGE(hookName, {payload: {from, data}}) {
    debug(`(peer ${from}) received message`, data);
    if (this._activated && from !== this.getUserId() &&
        (this._peers.has(from) || data.hangup == null)) {
      this.getPeerConnection(from).receiveMessage(data);
    }
    return [null];
  }

  // END OF API HOOKS

  updatePeerNameAndColor(userInfo) {
    if (!userInfo) return;
    const {userId, name = html10n.get('pad.userlist.unnamed'), colorId = 0} = userInfo;
    const $videoContainer = $(`#container_${getVideoId(userId)}`);
    if ($videoContainer.length === 0) return;
    $videoContainer.find('.user-name').attr('title', name).text(name);
    const color = typeof colorId === 'number' ? clientVars.colorPalette[colorId] : colorId;
    $videoContainer.css({borderLeftColor: color});
    ($videoContainer.data('updateMinSize') || (() => {}))();
  }

  showUserMediaError(err) { // show an error returned from getUserMedia
    err.devices.sort();
    const devices = err.devices.join('');
    let msgId = null;
    const extraInfo = $(document.createDocumentFragment());
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
          msgId = `error_permission_${devices}`;
          this.sendErrorStat('Permission');
        } else {
          msgId = 'error_ssl';
          this.sendErrorStat('SecureConnection');
        }
        break;
      case 'OverconstrainedError':
        debug(err);
        // Safari v14.1 on macOS v11.13.1 (Big Sur) on Sauce Labs emits OverconstrainedError when it
        // can't find a camera. Fall through to the NotFoundError case:
      case 'NotFoundError':
        msgId = `error_notFound_${devices}`;
        this.sendErrorStat('NotFound');
        break;
      case 'NotReadableError':
        msgId = 'error_notReadable';
        extraInfo.append($('<p>').text(err.message));
        this.sendErrorStat('Hardware');
        break;
      case 'AbortError':
        msgId = 'error_otherCantAccess';
        extraInfo.append($('<p>').text(err.message));
        this.sendErrorStat('Abort');
        break;
      default:
        // Let Etherpad's error handling handle the error.
        throw err;
    }
    const moreInfoUrl = this._settings.moreInfoUrl[msgId];
    if (moreInfoUrl) {
      extraInfo.append($('<p>').append($('<a>')
          .attr({href: moreInfoUrl, target: '_blank', rel: 'noopener noreferrer'})
          .text('Click here for more information.')));
    }
    $.gritter.add({
      title: 'Error',
      text: $(document.createDocumentFragment())
          .append($('<p>').text(html10n.get(`ep_webrtc_${msgId}`)))
          .append(extraInfo),
      sticky: true,
      class_name: 'error',
    });
    logErrorToServer(err);
  }

  // Performs the following steps for the local audio and/or video tracks:
  //   1. Read the state of the UI: Is the button in the enabled or disabled state?
  //   2. Try to make the track match the state of the UI.
  //   3. Update the state of the UI to reflect the actual state. For example, if the user set the
  //      audio button to enabled but we failed to get permission to access the microphone, then the
  //      button is changed back to disabled.
  async updateLocalTracks({updateAudio, updateVideo}) {
    // Prevent overlapping requests to access the microphone/camera. (If getUserMedia() is called
    // concurrently the browser might return different track objects from each call.)
    if (updateAudio) await this._trackLocks.audio.lock();
    if (updateVideo) await this._trackLocks.video.lock();
    try {
      const devices = [];
      const addAudioTrack = updateAudio && this._selfViewButtons.audio.enabled &&
          !this._localTracks.stream.getAudioTracks().some((t) => t.readyState === 'live');
      if (addAudioTrack) devices.push('mic');
      const addVideoTrack = updateVideo && this._selfViewButtons.video.enabled &&
          (!this._localTracks.stream.getVideoTracks().some((t) => t.readyState === 'live') ||
           this._localTracks.videoIsScreenshare);
      if (addVideoTrack) devices.push('cam');
      const addScreenshareTrack = updateVideo && this._selfViewButtons.screenshare.enabled &&
          !this._selfViewButtons.video.enabled && // Video button overrides screenshare button.
          (!this._localTracks.stream.getVideoTracks().some((t) => t.readyState === 'live') ||
           !this._localTracks.videoIsScreenshare);
      const getUserMedia = async () => {
        if (!addAudioTrack && !addVideoTrack) return new MediaStream();
        debug(`requesting permission to access ${devices.join(' and ')}`);
        const stream = await window.navigator.mediaDevices.getUserMedia({
          audio: addAudioTrack && this._settings.audio.constraints,
          video: addVideoTrack && this._settings.video.constraints,
        });
        debug('successfully accessed device(s)');
        return stream;
      };
      const getDisplayMedia = async () => {
        if (!addScreenshareTrack) return new MediaStream();
        debug('requesting permission to access screen');
        const stream = await window.navigator.mediaDevices.getDisplayMedia({
          video: {cursor: 'always'},
        });
        debug('successfully accessed screen');
        return new MediaStream(stream.getVideoTracks());
      };
      await Promise.all([[getUserMedia, devices], [getDisplayMedia, ['screen']]].map(
          async ([getMedia, devices]) => {
            let stream;
            try {
              stream = await getMedia();
            } catch (err) {
              // Display but otherwise ignore the error. The button(s) will be toggled back to
              // disabled below if we failed to access the microphone/camera. The user can re-click
              // the button to try again.
              err.devices = devices;
              (async () => this.showUserMediaError(err))();
              stream = new MediaStream();
            }
            for (const track of stream.getTracks()) {
              if (track.kind === 'video') {
                this._localTracks.videoIsScreenshare = devices.includes('screen');
              }
              this._localTracks.setTrack(track.kind, track);
            }
          }));
      if (updateAudio) {
        for (const track of this._localTracks.stream.getAudioTracks()) {
          // Re-check the state of the button because the user might have clicked it while
          // getUserMedia() was running.
          track.enabled = this._selfViewButtons.audio.enabled;
        }
        const hasAudio = this._localTracks.stream.getAudioTracks().some(
            (t) => t.enabled && t.readyState === 'live');
        this._selfViewButtons.audio.enabled = hasAudio;
      }
      if (updateVideo) {
        for (const track of this._localTracks.stream.getVideoTracks()) {
          // Re-check the state of the button because the user might have clicked it while
          // getUserMedia() or getDisplayMedia() was running.
          track.enabled = this._localTracks.videoIsScreenshare
            ? this._selfViewButtons.screenshare.enabled : this._selfViewButtons.video.enabled;
        }
        const hasVideo = this._localTracks.stream.getVideoTracks().some(
            (t) => t.enabled && t.readyState === 'live');
        this._selfViewButtons.video.enabled = hasVideo && !this._localTracks.videoIsScreenshare;
        this._selfViewButtons.screenshare.enabled =
            hasVideo && this._localTracks.videoIsScreenshare;
      }
    } finally {
      if (updateVideo) this._trackLocks.video.unlock();
      if (updateAudio) this._trackLocks.audio.unlock();
    }
    // For most browsers, autoplay with audio is allowed if the user grants access to the camera or
    // microphone, so unmuting auto-muted videos is likely to succeed.
    await this.unmuteAndPlayAll();
  }

  async activate() {
    if (!this._activated) {
      this._activated = (async () => {
        const $checkbox = $('#options-enablertc');
        $checkbox.prop('checked', true);
        debug('activating');
        $checkbox.prop('disabled', true);
        try {
          $('#rtcbox').css('display', 'flex');
          padcookie.setPref('rtcEnabled', true);
          this.hangupAll();
          this.invitePeer(null); // Broadcast an invite to everyone.
          await this.setStream(this.getUserId(), this._localTracks.stream);
          await this.updateLocalTracks({
            updateAudio: this._settings.audio.disabled !== 'hard',
            updateVideo: this._settings.video.disabled !== 'hard',
          });
        } finally {
          $checkbox.prop('disabled', false);
        }
        debug('activated');
      })();
    }
    await this._activated;
  }

  async deactivate(awaitActivated = true) {
    const $checkbox = $('#options-enablertc');
    $checkbox.prop('checked', false);
    if (awaitActivated) await this._activated;
    // Check this._activated after awaiting in case deactivate() is called multiple times while
    // activate() is running. (It's OK to await a null value.)
    if (!this._activated) return;
    debug('deactivating');
    $checkbox.prop('disabled', true);
    try {
      this._activated = null;
      padcookie.setPref('rtcEnabled', false);
      this.hangupAll();
      this.setStream(this.getUserId(), null);
      const $rtcbox = $('#rtcbox');
      $rtcbox.empty(); // In case any peer videos didn't get cleaned up for some reason.
      $rtcbox.hide();
      await this._trackLocks.audio.lock();
      await this._trackLocks.video.lock();
      try {
        for (const track of this._localTracks.stream.getTracks()) {
          this._localTracks.setTrack(track.kind, null);
        }
      } finally {
        this._trackLocks.video.unlock();
        this._trackLocks.audio.unlock();
      }
    } finally {
      $checkbox.prop('disabled', false);
    }
    debug('deactivated');
  }

  getUserFromId(userId) {
    if (!this._pad || !this._pad.collabClient) return null;
    const result = this._pad.collabClient
        .getConnectedUsers()
        .filter((user) => user.userId === userId);
    const user = result.length > 0 ? result[0] : null;
    return user;
  }

  async setStream(userId, stream) {
    let $video = $(`#${getVideoId(userId)}`);
    if (!stream) {
      $(`#container_${getVideoId(userId)}`).remove();
      return;
    }
    const isLocal = userId === this.getUserId();
    if ($video.length === 0) $video = this.addInterface(userId, isLocal);
    // Avoid flicker by checking if .srcObject already equals stream.
    if ($video[0].srcObject !== stream) $video[0].srcObject = stream;
    await this.playVideo($video);
  }

  async playVideo($video) {
    // play() will block indefinitely if there are no enabled tracks.
    if (!$video[0].srcObject.getTracks().some((t) => t.enabled)) return;
    debug('playing video', $video[0]);
    const $videoContainer = $(`#container_${$video[0].id}`);
    const $playErrorBtn = $videoContainer.find('.play-error-btn');
    try {
      await $video[0].play();
      debug('video is playing', $video[0]);
      $videoContainer.find('.automuted-error-btn')
          .css({display: $video.data('automuted') ? '' : 'none'});
      $playErrorBtn.css({display: 'none'});
    } catch (err) {
      debug('failed to play video', $video[0], err);
      // Browsers won't allow autoplayed video with sound until the user has interacted with the
      // page or the page is already capturing audio or video. If playback is not permitted, mute
      // the video and try again.
      if (err.name === 'NotAllowedError' && !$video[0].muted) {
        debug('auto-muting video', $video[0]);
        // The self view is always muted, so this click() only applies to videos of remote peers.
        $(`#interface_${$video.attr('id')} .audio-btn`).click();
        // Prevent infinite recursion if clicking the audio button didn't mute.
        if (!$video[0].muted) throw new Error('assertion failed: video element should be muted');
        $video.data('automuted', true);
        return await this.playVideo($video);
      }
      logErrorToServer(err);
      $playErrorBtn.css({display: ''});
    }
    ($videoContainer.data('updateMinSize') || (() => {}))();
  }

  // Tries to play any videos that aren't playing (including the self-view), or unmute videos that
  // are playing but were auto-muted (perhaps the browser prohibited autoplay). If playing or
  // unmuting a video fails (perhaps the browser still thinks we're trying to autoplay), the video
  // is auto-muted again.
  async unmuteAndPlayAll() {
    if (this._unmuteAndPlayAllInProgress) return; // Prevent infinite recursion if unmuting fails.
    this._unmuteAndPlayAllInProgress = true;
    try {
      await Promise.all($('#rtcbox video').map(async (i, video) => {
        const $video = $(video);
        if ($video.data('automuted')) $(`#interface_${$video.attr('id')} .audio-btn`).click();
        await this.playVideo($video);
      }).get());
    } finally {
      this._unmuteAndPlayAllInProgress = false;
    }
  }

  addInterface(userId, isLocal) {
    const _debug =
        (...args) => debug(`(${isLocal ? 'self-view' : `peer ${userId}`} interface)`, ...args);
    _debug('adding interface');
    const videoId = getVideoId(userId);
    const $name = $('<div>').addClass('user-name');
    const $video = $('<video>')
        .attr({
          id: videoId,
          // `playsinline` seems to be required on iOS (both Chrome and Safari), but not on any
          // other platform. `autoplay` might also be needed on iOS, or maybe it's superfluous (it
          // doesn't hurt to add it).
          playsinline: '',
          autoplay: '',
          muted: isLocal ? '' : null,
        })
        .prop({
          muted: isLocal, // Setting the 'muted' attribute isn't sufficient for some reason.
          volume: isLocal ? 0.0 : 1.0, // Long shot attempt at fixing echo in Safari.
        });
    const $interface = $('<div>')
        .addClass('interface-container')
        .attr('id', `interface_${videoId}`);
    const $videoContainer = $('<div>')
        .attr('id', `container_${videoId}`)
        .addClass('video-container')
        .toggleClass('local-user', isLocal)
        .css({width: '0', height: '0'})
        .append($name)
        .append($video)
        .append($interface)
        // `min-width: min-content` and `min-height: min-content` don't work on all browsers. Even
        // if they did, the peer name display has `position: absolute` so that a really long name
        // doesn't cause $videoContainer to become overly wide. This function sets `min-width` and
        // `min-height` to the actual computed lengths as needed.
        .data('updateMinSize', () => {
          // Allow $videoContainer to be too small so that we can detect overflow.
          $videoContainer.css({minWidth: '', minHeight: ''});
          const {height: nh} = $name[0].getBoundingClientRect();
          const {width: iw, height: ih} = $interface[0].getBoundingClientRect();
          const {width, height} = getContentSize($videoContainer[0]);
          // There is no API for determining the min-content width/height of an element, so
          // min width/height is only set if overflow is detected.
          $videoContainer.css({
            minWidth: iw > width ? `${iw}px` : '',
            minHeight: nh + ih > height ? `${nh + ih}px` : '',
          });
        });
    if (isLocal) $videoContainer.prependTo($('#rtcbox'));
    else $videoContainer.appendTo($('#rtcbox'));
    this.updatePeerNameAndColor(this.getUserFromId(userId));

    // For tests it is important to know when an asynchronous event handler has finishing handling
    // an event. This function wraps async event handler functions so that tests can wait for all
    // executions of an event handler to finish by calling `await $element.data('idle')(eventName)`.
    const addAsyncEventHandlers = ($element, asyncHandlers) => {
      const busy = {};
      const handlers = {};
      for (const [event, handler] of Object.entries(asyncHandlers)) {
        handlers[event] = (...args) => {
          const p = Promise.resolve(handler(...args));
          const busyp = busy[event] = p
              .catch(() => {}) // Exceptions should not interrupt the Promise chain.
              .then(Promise.resolve(busy[event]))
              .then(() => { if (busy[event] === busyp) delete busy[event]; });
          // Add a no-op .then() function to force an unhandled promise rejection if p rejects.
          p.then(() => {});
        };
      }
      $element.on(handlers);
      $element.data('idle', async (event) => { while (busy[event] != null) await busy[event]; });
    };

    // /////
    // Mute button
    // /////

    const $audioBtn =
        $('<span>').addClass('interface-btn audio-btn buttonicon').appendTo($interface);
    const audioInterface = {
      get enabled() { return !$audioBtn.hasClass('muted'); },
      set enabled(val) {
        $audioBtn
            .toggleClass('muted', !val)
            .attr('title', val ? 'Mute' : 'Unmute');
      },
    };
    if (isLocal) this._selfViewButtons.audio = audioInterface;
    const audioHardDisabled = isLocal && this._settings.audio.disabled === 'hard';
    // Remote views are never muted even if the peer is currently not sending any audio (the peer
    // could start sending audio at any moment). Exception: If the browser blocks autoplay, we
    // automatically mute the remote view by simulating a click on the mute button.
    audioInterface.enabled =
        !isLocal || (!audioHardDisabled && $('#options-audioenabledonstart').prop('checked'));
    if (audioHardDisabled) {
      $audioBtn.attr('title', 'Audio disallowed by admin').addClass('disallowed');
    }
    addAsyncEventHandlers($audioBtn, audioHardDisabled ? {} : {
      click: async () => {
        $video.removeData('automuted');
        const muted = audioInterface.enabled;
        _debug(`audio button clicked to ${muted ? 'dis' : 'en'}able audio`);
        audioInterface.enabled = !muted;
        if (isLocal) await this.updateLocalTracks({updateAudio: true});
        else $video[0].muted = muted;
        // Do not use `await` when calling unmuteAndPlayAll() because unmuting is best-effort
        // (success of this handler does not depend on the ability to unmute, and this handler's
        // idle/busy status should not be affected by unmuteAndPlayAll()). Call unmuteAndPlayAll()
        // late so that it can call $video[0].play() after $video[0].muted is set to its new value,
        // and so that it can auto-mute if necessary.
        this.unmuteAndPlayAll();
      },
    });

    // /////
    // Video and Screen Sharing Buttons
    // /////

    let $videoBtn;
    let $screenshareBtn;
    if (isLocal) {
      $videoBtn = $('<span>').addClass('interface-btn video-btn buttonicon').appendTo($interface);
      this._selfViewButtons.video = {
        get enabled() { return !$videoBtn.hasClass('off'); },
        set enabled(val) {
          $videoBtn
              .toggleClass('off', !val)
              .attr('title', val ? 'Disable video' : 'Enable video');
        },
      };
      const videoHardDisabled = this._settings.video.disabled === 'hard';
      this._selfViewButtons.video.enabled =
          !videoHardDisabled && $('#options-videoenabledonstart').prop('checked');
      if (videoHardDisabled) {
        $videoBtn.attr('title', 'Video disallowed by admin').addClass('disallowed');
      }
      const {navigator: {mediaDevices: {getDisplayMedia} = {}} = {}} = window;
      $screenshareBtn = $('<span>')
          .addClass('interface-btn screenshare-btn buttonicon')
          .css('display', typeof getDisplayMedia === 'function' ? '' : 'none')
          .appendTo($interface);
      this._selfViewButtons.screenshare = {
        get enabled() { return !$screenshareBtn.hasClass('off'); },
        set enabled(val) {
          $screenshareBtn
              .toggleClass('off', !val)
              .attr('title', val ? 'Stop screen share' : 'Start screen share');
        },
      };
      this._selfViewButtons.screenshare.enabled = false;
      addAsyncEventHandlers($videoBtn, videoHardDisabled ? {} : {
        click: async () => {
          const videoEnabled = !this._selfViewButtons.video.enabled;
          _debug(`video button clicked to ${videoEnabled ? 'en' : 'dis'}able video`);
          this._selfViewButtons.video.enabled = videoEnabled;
          // Unconditionally disable screen sharing. Either the camera was previously disabled in
          // which case the user now wants to share camera video, or the camera was previously
          // enabled in which case the user now wants to shut off all video.
          this._selfViewButtons.screenshare.enabled = false;
          await this.updateLocalTracks({updateVideo: true});
          // Don't use `await` here -- see the comment for the audio button click handler above.
          this.unmuteAndPlayAll();
        },
      });
      addAsyncEventHandlers($screenshareBtn, {
        click: async () => {
          const screenshareEnabled = !this._selfViewButtons.screenshare.enabled;
          _debug(`button clicked to ${screenshareEnabled ? 'en' : 'dis'}able screen sharing`);
          // Unconditionally disable the camera. Either screen sharing was previously disabled in
          // which case the user now wants to share the screen, or screen sharing was previously
          // enabled in which case the user wants to shut off all video.
          this._selfViewButtons.video.enabled = false;
          this._selfViewButtons.screenshare.enabled = screenshareEnabled;
          await this.updateLocalTracks({updateVideo: true});
          // Don't use `await` here -- see the comment for the audio button click handler above.
          this.unmuteAndPlayAll();
        },
      });
    }

    // /////
    // Enlarge Video button
    // /////

    let videoEnlarged = false;
    const resizeElements = [$video, $videoContainer];
    let aspectRatio = null;
    const setVideoSize = () => {
      const wide = !aspectRatio || aspectRatio >= 1.0;
      const longSide =
          !aspectRatio ? 0 : this._settings.video.sizes[videoEnlarged ? 'large' : 'small'];
      const shortSide = !aspectRatio ? 0 : longSide * (wide ? 1.0 / aspectRatio : aspectRatio);
      $videoContainer.css({
        height: `${wide ? shortSide : longSide}px`,
        width: `${wide ? longSide : shortSide}px`,
      });
      ($videoContainer.data('updateMinSize') || (() => {}))();
    };
    const $enlargeBtn = $('<span>')
        .addClass('interface-btn enlarge-btn buttonicon')
        .css({display: 'none'}) // Will become visible once a video is added.
        .attr('title', 'Make video larger')
        .on({
          click: (event) => {
            // Temporarily add a transition rule to smoothly animate the size change. The rule is
            // removed after transition finishes so that dragging the resize handle is smooth.
            for (const $elt of resizeElements) $elt.css('transition', 'width .3s, height .3s');

            videoEnlarged = !videoEnlarged;
            $(event.currentTarget)
                .attr('title', videoEnlarged ? 'Make video smaller' : 'Make video larger')
                .toggleClass('large', videoEnlarged);
            setVideoSize();
            // Don't use `await` here -- see the comment for the audio button click handler above.
            this.unmuteAndPlayAll();
          },
        })
        .appendTo($interface);
    for (const $element of resizeElements) {
      $element.on('transitionend transitioncancel', (event) => {
        $element.css('transition', '');
        ($videoContainer.data('updateMinSize') || (() => {}))();
      });
    }

    // /////
    // Alerts
    // /////

    // Spacer to push the alerts to the right.
    $interface.append($('<span>').css({flex: '1 0 0'}));

    // TODO: These should be converted into accessible popovers/toggletips that work on touch-only
    // devices. See: https://inclusive-components.design/tooltips-toggletips/
    const errorBtns = [
      {
        cls: 'automuted-error-btn',
        title: 'Your browser blocked audio playback. Click to unmute.',
        click: () => this.unmuteAndPlayAll(),
      },
      {
        cls: 'disconnected-error-btn',
        title: 'Connection lost; waiting for automatic reconnect. Click to force reconnection.',
        click: () => { this.hangup(userId); this.getPeerConnection(userId); },
      },
      {
        cls: 'play-error-btn',
        title: 'Playback failed. Click to retry.',
        click: () => this.unmuteAndPlayAll(),
      },
      ...(isLocal ? [
        {
          cls: 'audioended-error-btn',
          title: 'Audio stopped unexpectedly. Click to retry.',
          click: () => $audioBtn.click(),
        },
        {
          cls: 'videoended-error-btn',
          title: 'Video stopped unexpectedly. Click to retry.',
          click: () => (this._localTracks.videoIsScreenshare ? $screenshareBtn : $videoBtn).click(),
        },
      ] : []),
    ];
    for (const {cls, title, click} of errorBtns) {
      $interface.append($('<span>')
          .addClass(`interface-btn error-btn buttonicon ${cls}`)
          .css({display: 'none'}) // Will become visible if there is an error.
          .attr({title})
          .on({click}));
    }

    // /////
    // Resize handle
    // /////

    // TODO: Add support for pinch zooming via touch events:
    // https://developer.mozilla.org/en-US/docs/Web/API/Touch_events
    $videoContainer.append($('<div>')
        .addClass('resize-handle')
        .attr('title', 'Drag to resize')
        .appendTo($videoContainer)
        .on({
          // Pointer events (https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) are
          // preferred over mouse events because the user might be on a touchscreen device (e.g.,
          // smartphone).
          pointerdown: ({originalEvent: pd}) => {
            if (!pd.isPrimary) return;
            pd.preventDefault();
            pd.currentTarget.setPointerCapture(pd.pointerId);
            const initialSize = getContentSize($videoContainer[0]);
            const {x: initialX, y: initialY} = $videoContainer[0].getBoundingClientRect();
            const onpointermove = (pm) => {
              if (pm.pointerId !== pd.pointerId) return;
              pm.preventDefault();
              videoEnlarged = true;
              $enlargeBtn.attr('title', 'Reset video size').addClass('large');
              // Adjust the video container's size both by how much the pointer has moved and by how
              // much the container itself has moved. The latter is included so that resizing
              // behaves as users expect when the act of resizing itself causes an overflowing
              // container to scroll into or out of view.
              const {x, y} = $videoContainer[0].getBoundingClientRect();
              const newSize = [
                Math.max(0.0, initialSize.width + pm.screenX - pd.screenX + initialX - x),
                Math.max(0.0, initialSize.height + pm.screenY - pd.screenY + initialY - y),
              ];
              if (aspectRatio) {
                // Preserve the aspect ratio by projecting newSize onto the aspect ratio vector.
                // Projection is preferred over other approaches because it provides a more natural
                // user experience.
                const arv = [aspectRatio, 1.0];
                const m = dot(newSize, arv) / dot(arv, arv);
                newSize[0] = m * arv[0];
                newSize[1] = m * arv[1];
              }
              $videoContainer.css({
                aspectRatio: '', // Browser resize behavior is weird if aspect-ratio is set.
                width: `${newSize[0]}px`,
                height: `${newSize[1]}px`,
              });
              ($videoContainer.data('updateMinSize') || (() => {}))();
            };
            const onpointerup = (pu) => {
              if (pu.pointerId !== pd.pointerId) return;
              pu.preventDefault();
              pu.target.releasePointerCapture(pu.pointerId);
              ($videoContainer.data('updateMinSize') || (() => {}))();
              for (const win of this._windows) {
                win.document.body.style.cursor = '';
                win.document.body.style.touchAction = '';
                win.removeEventListener('pointermove', onpointermove);
                win.removeEventListener('pointerup', onpointerup);
                win.removeEventListener('pointercancel', onpointerup);
              }
            };
            for (const win of this._windows) {
              win.document.body.style.cursor = 'nwse-resize';
              win.document.body.style.touchAction = 'none';
              win.addEventListener('pointermove', onpointermove);
              win.addEventListener('pointerup', onpointerup);
              win.addEventListener('pointercancel', onpointerup);
            }
          },
        }));

    $video.on({
      resize: (event) => {
        const {videoWidth: vw, videoHeight: vh} = event.currentTarget;
        aspectRatio = vw && vh ? 1.0 * vw / vh : null;
        videoEnlarged = false;
        $enlargeBtn
            .removeClass('large')
            .attr('title', 'Make video larger')
            .css({display: aspectRatio != null ? '' : 'none'});
        setVideoSize();
      },
    });

    $videoContainer.data('updateMinSize')();
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
    this._pad.socket.emit('message', msg);
  }

  sendMessage(to, data) {
    if (data.ids == null) data.ids = {};
    if (data.ids.from == null) data.ids.from = {};
    data.ids.from.session = sessionId;
    debug(`(${to == null ? 'to everyone on the pad' : `peer ${to}`}) sending message`, data);
    this._pad.collabClient.sendMessage({
      type: 'RTC_MESSAGE',
      payload: {data, to},
    });
  }

  hangupAll() {
    for (const userId of this._peers.keys()) this.hangup(userId);
    // Broadcast a hangup message to everyone, even to peers that we did not have a WebRTC
    // connection with. This prevents inconsistent state if the user disables WebRTC after an invite
    // is sent but before the remote peer initiates the connection.
    this.sendMessage(null, {hangup: 'hangup'});
  }

  getUserId() {
    return this._pad.getUserId();
  }

  hangup(userId) {
    debug(`(peer ${userId}) hangup`);
    this.setStream(userId, null);
    const peer = this._peers.get(userId);
    if (peer == null) return;
    peer.close();
    this._peers.delete(userId);
  }

  // See if the peer is interested in establishing a WebRTC connection. If the peer isn't interested
  // it will ignore the invite; if it is interested, it will either initiate a WebRTC connection (if
  // it has a track to stream) or it send back an invite of its own (if it doesn't have a track to
  // stream). If an uninterested peer later becomes interested, the peer will send an invite.
  //
  // DO NOT connect to the peer unless invited by the peer because an uninterested peer will discard
  // the WebRTC signaling messages. This is bad because WebRTC assumes reliable, in-order delivery
  // of signaling messages, so the discards will break future connection attempts.
  invitePeer(userId) {
    this.sendMessage(userId, {invite: 'invite'});
  }

  getPeerConnection(userId) {
    let peer = this._peers.get(userId);
    if (peer == null) {
      const _debug = (...args) => debug(`(peer ${userId})`, ...args);
      _debug('creating PeerState');
      peer = new PeerState(
          {iceServers: this._settings.iceServers},
          isCaller(this.getUserId(), userId),
          (msg) => this.sendMessage(userId, msg),
          this._localTracks,
          _debug);
      this._peers.set(userId, peer);
      let logDisconnectErrorTimeout = null;
      peer.addEventListener('stream', async ({stream}) => {
        _debug(`remote stream ${stream.id} added`);
        const $videoContainer = $(`#container_${getVideoId(userId)}`);
        $videoContainer.find('.disconnected-error-btn').css({display: 'none'});
        clearTimeout(logDisconnectErrorTimeout);
        ($videoContainer.data('updateMinSize') || (() => {}))();
        await this.setStream(userId, stream);
      });
      peer.addEventListener('streamgone', async ({stream}) => {
        _debug(`remote stream ${stream.id} removed`);
        const $videoContainer = $(`#container_${getVideoId(userId)}`);
        $videoContainer.find('.disconnected-error-btn').css({display: ''});
        // The userLeave hook isn't called until it has been 8s since the peer left. Wait a bit
        // longer than that before logging the disconnect to the server.
        logDisconnectErrorTimeout =
            setTimeout(() => logErrorToServer(new Error('RTC connection lost'), 0), 10000);
        ($videoContainer.data('updateMinSize') || (() => {}))();
        await this.setStream(userId, new MediaStream());
      });
      peer.addEventListener('closed', () => {
        _debug('PeerState closed');
        clearTimeout(logDisconnectErrorTimeout);
        this.hangup(userId);
        // The peer might have disconnected due to an error, not because the user navigated away.
        // Re-invite the peer to retry the connection. If the peer really did leave then it will
        // ignore the invite. A random delay is added to avoid an infinite hangup-invite loop.
        //
        // TODO: Figure out if the delay can be safely removed. If not, cancel the timeout if the
        // peer leaves the pad or the plugin is deactivated.
        setTimeout(() => this.invitePeer(userId), 500 * Math.random() + 500);
      });
    }
    return peer;
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
