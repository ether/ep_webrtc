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

var padcookie = require('ep_etherpad-lite/static/js/pad_cookie').padcookie;
var hooks = require('ep_etherpad-lite/static/js/pluginfw/hooks');

var rtc = (function()
{
  var isActive = false;
  var pc_config = {};
  var pc_constraints = {
    optional: [{
      DtlsSrtpKeyAgreement: true
    }]
  };
  var sdpConstraints = {
    mandatory: {
      'OfferToReceiveAudio': true,
      'OfferToReceiveVideo': true
    }
  };
  var localStream, remoteStream = {}, pc = {}, callQueue = [];

  var self = {
    //API HOOKS
    postAceInit: function(hook, context, callback)
    {
      $('<div>').attr({'id': 'rtcbox'}).css({
        'position': 'absolute',
        'bottom': '0',
        'left': '0',
        'top': '37px',
        'width': '130px',
        'z-index': '400',
        'border-right': '1px solid #999',
        'border-top': '1px solid #999',
        'padding': '3px',
        'padding-bottom': '10px',
        'background-color': '#f1f1f1',
        'height': 'auto',
        'border': 'none',
        'border-right': '1px solid #ccc',
        'display': 'none',
      }).appendTo($('body'));

      pc_config.iceServers = clientVars.webrtc && clientVars.webrtc.iceServers
        ? clientVars.webrtc.iceServers
        : [{
          url: webrtcDetectedBrowser == "firefox"
            ? "stun:23.21.150.121"
            : "stun:stun.l.google.com:19302"
        }];
      self.init(context.pad);
      callback();
    },
    aceSetAuthorStyle: function(hook, context, callback)
    {
      if (context.author && context.info && context.info.bgcolor) {
        $('#video_' + context.author.replace(/\./g, '_')).css({
          'border-color': context.info.bgcolor
        });
      }
      callback();
    },
    userJoinOrUpdate: function(hook, context, callback)
    {
      //console.log(hook, arguments);
      var userId = context.userInfo.userId;
      if (userId && pc[userId]) {
        //console.log('remove stale peer connection', info.userId);
        self.hangup(userId, false);
      }
      callback();
    },
    userLeave: function(hook, context, callback)
    {
      var userId = context.userInfo.userId;
      if (userId && pc[userId]) {
        self.hangup(userId, false);
      }
      callback();
    },
    handleClientMessage_RTC_MESSAGE: function(hook, context, callback) {
      if (isActive) {
        self.receiveMessage(context.payload);
      }
      callback([null]);
    },
    //END OF API HOOKS
    show: function ()
    {
      $("#rtcbox").show();
      var right = $('#editorcontainer').css('right');
      right = right == 'auto' ? '0px' : right;
      $('#editorcontainer').css({"left":"130px", "width": "auto", "right": right});
    },
    hide: function ()
    {
      $("#rtcbox").hide();
      $('#editorcontainer').css({"left":"0"});
    },
    toggleActive: function(force)
    {
      if (force === true || !padcookie.getPref("rtcEnabled")) {
        padcookie.setPref("rtcEnabled", true);
        self.show();
        self.getUserMedia();
        isActive = true;
      } else {
        padcookie.setPref("rtcEnabled", false);
        self.hide();
        self.hangupAll();
        if (localStream) {
          self.setStream(self._pad.getUserId(), '');
          localStream.stop();
          localStream = null;
        }
        isActive = false;
      }
    },
    toggleMuted: function()
    {
      var audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return !audioTrack.enabled;
      }
    },
    toggleVideo: function()
    {
      var videoTrack = localStream.getVideoTracks()[0];
      if(videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        var $interface = $('#interface_video_' + self.getUserId().replace(/\./g, '_'));
        if (!videoTrack.enabled) {
          $('<div>')
            .attr('id', 'disabled_video_' + self.getUserId().replace(/\./g, '_'))
            .css({
             'z-index': 400,
              position: 'fixed',
              top: $interface.position().top + 'px',
              left: $interface.position().left + 'px',
              width: $interface.width() + 'px',
              height: $interface.height() + 'px',
              'background-color': 'rgb(0,0,0)',
              opacity: 1
            })
            .appendTo($('body'));
        } else {
            $('#disabled_video_' + self.getUserId().replace(/\./g, '_')).remove();
        }
        return !videoTrack.enabled;
      }
    },
    setStream: function(userId, stream)
    {
      var isLocal = userId == self.getUserId();
      var videoId = 'video_' + userId.replace(/\./g, '_');
      var video = $('#' + videoId)[0];
      var colorId = self._pad.collabClient.getConnectedUsers()
        .filter(function(user) { return user.userId == userId; })
        .map(function(user) { return user.colorId; })[0];
      if (!video && stream) {
        video = $('<video>')
          .attr('id', videoId)
          .css({
            'maxWidth': '128px',
            'maxHeight': '128px',
            'border-left': '4px solid',
            'border-color': colorId
          })
          .on({
            loadedmetadata: function() {
              self.addInterface(userId);
            }
          })
          .appendTo($('#rtcbox'))[0];
        video.autoplay = true;
        if (isLocal) {
          video.muted = true;
        }
        self.addInterface(userId);
      }
      if (stream) {
        attachMediaStream(video, stream);
      } else if (video) {
        $(video).remove();
        $('#interface_' + videoId).remove();
      }
    },
    addInterface: function(userId)
    {
      var isLocal = userId == self.getUserId();
      var videoId = 'video_' + userId.replace(/\./g, '_');
      var $video = $('#' + videoId);
      var offset = $video.offset();
      var size = {width: $video.width(), height: $video.height()};

      var $mute = $('<div>')
        .css({
          'text-align': 'right',
          'margin-top': '48px',
          color: 'white'
        })
        .html('<span style="background: black;padding: 2px;cursor:pointer">Mute</span>')
        .on({
          click: function(event) {
            var muted;
            if (isLocal) {
              muted = self.toggleMuted();
            } else {
              $video[0].muted = !$video[0].muted;
              muted = $video[0].muted;
            }
            $mute.find('span').html(muted ? 'Unmute' : 'Mute');
          }
        });
      var $disableVideo = isLocal ? $('<div>')
        .css({
          'text-align': 'right',
          color: 'white',
          'margin-top': '8px'
        })
        .html('<span style="background: black;padding: 2px;cursor:pointer">Disable Video</span>')
        .on({
          click: function(event) {
            var disableVideo = self.toggleVideo();
            $disableVideo.find('span').html(disableVideo ? 'Enable Video' : 'Disable Video');
          }
        }) : $('<div>');
      $('#interface_' + videoId).remove();
      $('<div>')
        .attr('id', 'interface_' + videoId)
        .css({
         'z-index': 401,
          position: 'fixed',
          top: offset.top + 'px',
          left: (offset.left + 4) + 'px',
          width: size.width + 'px',
          height: size.height + 'px',
          //'background-color': $video.css('border-color'),
          opacity: 0
        })
        .on({
          mouseover: function(event)  {
            $(this).css({
              //'background-color': $video.css('border-color'),
              opacity: 1
            })
          },
          mouseout: function(event)  {
            $(this).css({
              opacity: 0
            })
          },
        })
        .append($mute)
        .append($disableVideo)
        .appendTo($('body'));
    },
    sendMessage: function(to, data)
    {
      self._pad.collabClient.sendMessage({"type": "RTC_MESSAGE", payload: {"data": data, "to": to}});
    },
    receiveMessage: function(msg)
    {
      var peer = msg.from, data = msg.data, type = data.type;
      /*
      if (type != 'icecandidate')
        console.log('receivedMessage', 'peer', peer, 'type', type, 'data', data);
      */
      if (type == "hangup") {
        self.hangup(peer, false);
      } else if (type == "offer") {
        if (pc[peer]) {
            //console.log('ignore offer?', pc[peer].localDescription);
            return;
        } else {
            self.createPeerConnection(peer);
        }
        if(localStream) {
            if (pc[peer].getLocalStreams) {
                if (!pc[peer].getLocalStreams().length) {
                  pc[peer].addStream(localStream);
                }
            } else if (pc[peer].localStreams) {
                if (!pc[peer].localStreams.length) {
                    pc[peer].addStream(localStream);
                }
            }
        }
        pc[peer].setRemoteDescription(new RTCSessionDescription(data.offer), function() {
          pc[peer].createAnswer(function(desc) {
            desc.sdp = preferOpus(desc.sdp);
            pc[peer].setLocalDescription(desc, function() {
              self.sendMessage(peer, {type: "answer", answer: pc[peer].localDescription});
            }, logError);
          }, logError, sdpConstraints);
        }, logError);
      } else if (type == "answer") {
        if (pc[peer]) {
          pc[peer].setRemoteDescription(new RTCSessionDescription(data.answer, function() {
          }, logError));
        }
      } else if (type == "icecandidate") {
        if (pc[peer]) {
          pc[peer].addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } else {
        console.log('unknown message', data);
      }
    },
    hangupAll: function() {
      Object.keys(pc).forEach(function(userId) {
        self.hangup(userId);
      });
    },
    getUserId: function() {
      return self._pad && self._pad.getUserId();
    },
    hangup: function(userId, notify)
    {
      notify = arguments.length == 1 ? true : notify;
      if (pc[userId] && userId != self.getUserId()) {
        self.setStream(userId, '');
        pc[userId].close();
        delete pc[userId];
        notify && self.sendMessage(userId, {type: "hangup"});
      }
    },
    call: function(userId)
    {
      if (pc[userId]) {
        self.createOffer(userId);
        return;
      }
      if (!localStream) {
        callQueue.push(userId);
        return;
      }
      self.createPeerConnection(userId);
      pc[userId].addStream(localStream);
      if (webrtcDetectedBrowser == "firefox") {
        self.createOffer(userId);
      }
    },
    createPeerConnection: function(userId)
    {
      if(pc[userId]) {
        console.log('WARNING creating PC connection even though one exists', userId);
      }
      pc[userId] = new RTCPeerConnection(pc_config, pc_constraints);
      pc[userId].onicecandidate = function(event) {
        if (event.candidate) {
          self.sendMessage(userId, {
              type: "icecandidate",
              candidate: event.candidate
          });
        }
      };
      pc[userId].onaddstream = function(event) {
        remoteStream[userId] = event.stream;
        self.setStream(userId, event.stream);
      };
      pc[userId].onremovestream = function(event) {
        self.setStream(userId, '');
      };
      pc[userId].onnegotiationneeded = function(event) {
        //console.log('onnegotiationneeded', userId, event);
        self.createOffer(userId);
      };
      /*
      pc[userId].onnsignalingstatechange = function(event) {
        console.log('onsignalingstatechange;', event);
      };
      pc[userId].oniceconnectionstatechange = function(event) {
        console.log('oniceconnectionstatechange', event);
      };
      */
    },
    createOffer: function(userId) {
      var constraints = {optional: [], mandatory: {MozDontOfferDataChannel: true}};
      var offer;
      // temporary measure to remove Moz* constraints in Chrome
      if (webrtcDetectedBrowser === "chrome") {
        for (prop in constraints.mandatory) {
          if (prop.indexOf("Moz") != -1) {
            delete constraints.mandatory[prop];
          }
        }
      }
      constraints = mergeConstraints(constraints, sdpConstraints);
      pc[userId].createOffer(function(desc) {
        desc.sdp = preferOpus(desc.sdp);
        pc[userId].setLocalDescription(desc, function() {
          self.sendMessage(userId, {type: "offer", offer: pc[userId].localDescription});
        }, logError);
      }, logError, constraints);
    },
    getUserMedia: function()
    {
      // Setup Camera and Microphone
      var mediaConstraints = {
        audio: true,
        video: {
          optional: [],
          mandatory: {
            maxWidth: 320,
            maxHeight: 240
          }
        }
      };
      getUserMedia(mediaConstraints, function(stream) {
        localStream = stream;
        self.setStream(self._pad.getUserId(), stream);
        self._pad.collabClient.getConnectedUsers().forEach(function(user) {
          if (pc[user.userId]) {
            self.hangup(user.userId);
          }
          self.call(user.userId);
        });
      }, logError);
    },
    init: function(pad)
    {
      self._pad = pad || window.pad;
      var rtcEnabled = padcookie.getPref("rtcEnabled");
      if (typeof rtcEnabled == 'undefined') {
        rtcEnabled = $('#options-enablertc').prop('checked');
      }

      if(clientVars.webrtc.listenClass){
        $(clientVars.webrtc.listenClass).on('click', function(){
          self.toggleActive(true);
        });
      }
 
      if(clientVars.webrtc.enabled){
        if (rtcEnabled) {
          $('#options-enablertc').prop('checked', true);
          self.toggleActive(true);
        } else {
          $('#options-enablertc').prop('checked', false);
        }
      }
      $('#options-enablertc').on('change', function() {
        self.toggleActive();
      })
      if (isActive) {
        $(window).unload(function () {
          self.hangupAll();
        });
      }
    }
  }

  // Normalize RTC implementation between browsers

  var RTCPeerConnection = null;
  var getUserMedia = null;
  var attachMediaStream = null;
  var reattachMediaStream = null;
  var webrtcDetectedBrowser = null;

  if (navigator.mozGetUserMedia) {
    webrtcDetectedBrowser = "firefox";

    // The RTCPeerConnection object.
    RTCPeerConnection = mozRTCPeerConnection;

    // The RTCSessionDescription object.
    RTCSessionDescription = mozRTCSessionDescription;

    // The RTCIceCandidate object.
    RTCIceCandidate = mozRTCIceCandidate;

    // Get UserMedia (only difference is the prefix).
    // Code from Adam Barth.
    getUserMedia = navigator.mozGetUserMedia.bind(navigator);

    // Attach a media stream to an element.
    attachMediaStream = function(element, stream) {
      element.mozSrcObject = stream;
      element.play();
    };

    reattachMediaStream = function(to, from) {
      to.mozSrcObject = from.mozSrcObject;
      to.play();
    };

    // Fake get{Video,Audio}Tracks
    if (!MediaStream.prototype.getVideoTracks) {
        MediaStream.prototype.getVideoTracks = function() {
          console.log('MediaStream.prototype.getVideoTracks missing');
          return [];
        };
    };

    if (!MediaStream.prototype.getAudioTracks) {
        MediaStream.prototype.getAudioTracks = function() {
          console.log('MediaStream.prototype.getAudioTracks missing');
          return [];
        };
    };

  } else if (navigator.webkitGetUserMedia) {

    webrtcDetectedBrowser = "chrome";

    // The RTCPeerConnection object.
    RTCPeerConnection = webkitRTCPeerConnection;

    // Get UserMedia (only difference is the prefix).
    // Code from Adam Barth.
    getUserMedia = navigator.webkitGetUserMedia.bind(navigator);

    // Attach a media stream to an element.
    attachMediaStream = function(element, stream) {
      if (typeof element.srcObject !== 'undefined') {
        element.srcObject = stream;
      } else if (typeof element.mozSrcObject !== 'undefined') {
        element.mozSrcObject = stream;
      }  else if (typeof element.src !== 'undefined') {
        element.src = URL.createObjectURL(stream);
        //element.src = webkitURL.createObjectURL(stream);
      } else {
        console.log('Error attaching stream to element.', element);
      }
    };

    reattachMediaStream = function(to, from) {
      to.src = from.src;
    };

    // The representation of tracks in a stream is changed in M26.
    // Unify them for earlier Chrome versions in the coexisting period.
    if (!webkitMediaStream.prototype.getVideoTracks) {
      webkitMediaStream.prototype.getVideoTracks = function() {
        return this.videoTracks;
      };
      webkitMediaStream.prototype.getAudioTracks = function() {
        return this.audioTracks;
      };
    }

    // New syntax of getXXXStreams method in M26.
    if (!webkitRTCPeerConnection.prototype.getLocalStreams) {
      webkitRTCPeerConnection.prototype.getLocalStreams = function() {
        return this.localStreams;
      };
      webkitRTCPeerConnection.prototype.getRemoteStreams = function() {
        return this.remoteStreams;
      };
    }
  } else {
    console.log("Browser does not appear to be WebRTC-capable");
  }

  // Set Opus as the default audio codec if it's present.
  function preferOpus(sdp) {
    var sdpLines = sdp.split('\r\n');

    // Search for m line.
    for (var i = 0; i < sdpLines.length; i++) {
        if (sdpLines[i].search('m=audio') !== -1) {
          var mLineIndex = i;
          break;
        }
    }
    if (mLineIndex === null)
      return sdp;

    // If Opus is available, set it as the default in m line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('opus/48000') !== -1) {
        var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
        if (opusPayload)
          sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], opusPayload);
        break;
      }
    }

    // Remove CN in m line and sdp.
    sdpLines = removeCN(sdpLines, mLineIndex);

    sdp = sdpLines.join('\r\n');
    return sdp;
  }

  // Set Opus in stereo if stereo is enabled.
  function addStereo(sdp) {
    var sdpLines = sdp.split('\r\n');

    // Find opus payload.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('opus/48000') !== -1) {
        var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
        break;
      }
    }

    // Find the payload in fmtp line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('a=fmtp') !== -1) {
        var payload = extractSdp(sdpLines[i], /a=fmtp:(\d+)/ );
        if (payload === opusPayload) {
          var fmtpLineIndex = i;
          break;
        }
      }
    }
    // No fmtp line found.
    if (fmtpLineIndex === null)
      return sdp;

    // append stereo=1 to fmtp line.
    sdpLines[fmtpLineIndex] = sdpLines[fmtpLineIndex].concat(' stereo=1');

    sdp = sdpLines.join('\r\n');
    return sdp;
  }

  function extractSdp(sdpLine, pattern) {
    var result = sdpLine.match(pattern);
    return (result && result.length == 2)? result[1]: null;
  }

  // Set the selected codec to the first in m line.
  function setDefaultCodec(mLine, payload) {
    var elements = mLine.split(' ');
    var newLine = new Array();
    var index = 0;
    for (var i = 0; i < elements.length; i++) {
      if (index === 3) // Format of media starts from the fourth.
        newLine[index++] = payload; // Put target payload to the first.
      if (elements[i] !== payload)
        newLine[index++] = elements[i];
    }
    return newLine.join(' ');
  }

  // Strip CN from sdp before CN constraints is ready.
  function removeCN(sdpLines, mLineIndex) {
    var mLineElements = sdpLines[mLineIndex].split(' ');
    // Scan from end for the convenience of removing an item.
    for (var i = sdpLines.length-1; i >= 0; i--) {
      var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
      if (payload) {
        var cnPos = mLineElements.indexOf(payload);
        if (cnPos !== -1) {
          // Remove CN payload from m line.
          mLineElements.splice(cnPos, 1);
        }
        // Remove CN line in sdp
        sdpLines.splice(i, 1);
      }
    }

    sdpLines[mLineIndex] = mLineElements.join(' ');
    return sdpLines;
  }
  function mergeConstraints(cons1, cons2) {
    var merged = cons1;
    for (var name in cons2.mandatory) {
      merged.mandatory[name] = cons2.mandatory[name];
    }
    merged.optional.concat(cons2.optional);
    return merged;
  }
  function logError(error) {
    console.log('WebRTC ERROR:', error);
  }
  self.pc = pc;
  return self;
}());

exports.rtc = rtc;

