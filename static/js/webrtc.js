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

var padcookie = require('ep_etherpad-lite/static/js/pad_cookie').padcookie;
var hooks = require('ep_etherpad-lite/static/js/pluginfw/hooks');

var rtc = (function()
{
  var isActive = false;
  var isSupported = (typeof(navigator.mediaDevices) !== "undefined");
  var localStream, remoteStream = {}, pc = {}, callQueue = [], pc_config = {};

  var self = {
    //API HOOKS
    postAceInit: function(hook, context, callback)
    {
      var top = $('div#editbar').offset().top + $('div#editbar').height() + 5;
      $('<div>').attr({'id': 'rtcbox'}).css({
        'position': 'absolute',
        'bottom': '0',
        'left': '0',
        'top': top + 'px',
        'width': '130px',
        'z-index': '1',
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
      /*
      var userId = context.userInfo.userId;
      console.log('userJoinOrUpdate', context, context.userInfo.userId, pc[userId]);
      */
      callback();
    },
    userLeave: function(hook, context, callback)
    {
      var userId = context.userInfo.userId;
      //console.log('user left, hang up', userId, context, pc[userId]);
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
    showNotSupported: function()
    {
      $("#rtcbox").empty().append($('<div>').css({
        "padding": "8px",
        "padding-top": "32px"
      }).html(
          'Sorry, your browser does not support WebRTC.'
        + '<br><br>'
        + 'To participate in this audio/video chat you have to user a browser with WebRTC support like Chrome, Firefox or Opera.'
        + ' <a href="http://www.webrtc.org/" target="_new">Find out more</a>'
      ));
    },
    hide: function ()
    {
      $("#rtcbox").hide();
      $('#editorcontainer').css({"left":"0"});
    },
    activate: function()
    {
        $('#options-enablertc').prop('checked', true);
        if (isActive) return;
        self.show();
        if (isSupported) {
          padcookie.setPref("rtcEnabled", true);
          self.getUserMedia();
        } else {
          self.showNotSupported();
        }
        isActive = true;
    },
    deactivate: function()
    {
        $('#options-enablertc').prop('checked', false);
        if (!isActive) return;
        self.hide();
        if (isSupported) {
          padcookie.setPref("rtcEnabled", false);
          self.hangupAll();
          if (localStream) {
            self.setStream(self._pad.getUserId(), '');
            localStream.stop();
            localStream = null;
          }
        }
        isActive = false;
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
             'z-index': '1',
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
         'z-index': '2',
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
      if (peer == self.getUserId()) {
        // console.log('ignore own messages');
        return;
      }
      /*
      if (type != 'icecandidate')
        console.log('receivedMessage', 'peer', peer, 'type', type, 'data', data);
      */
      if (type == "hangup") {
        self.hangup(peer, false);
      } else if (type == "offer") {
        if (pc[peer]) {
          console.log('existing connection?', pc[peer]);
          self.hangup(peer, false);
          self.createPeerConnection(peer);
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
        var offer = new RTCSessionDescription(data.offer);
        pc[peer].setRemoteDescription(offer, function() {
          pc[peer].createAnswer(function(desc) {
            // desc.sdp = cleanupSdp(desc.sdp);
            pc[peer].setLocalDescription(desc, function() {
              self.sendMessage(peer, {type: "answer", answer: desc});
            }, logError);
          }, logError, sdpConstraints);
        }, logError);
      } else if (type == "answer") {
        if (pc[peer]) {
          var answer = new RTCSessionDescription(data.answer);
          pc[peer].setRemoteDescription(answer, function() {}, logError);
        }
      } else if (type == "icecandidate") {
        if (pc[peer]) {
          var candidate = new RTCIceCandidate(data.candidate);
          var p = pc[peer].addIceCandidate(candidate);
          if (p) {
              p.then(function() {
                // Do stuff when the candidate is successfully passed to the ICE agent
              }).catch(function() {
                console.log("Error: Failure during addIceCandidate()", data);
              });
          }
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
      if (!localStream) {
        callQueue.push(userId);
        return;
      }

      if (!pc[userId]) {
        self.createPeerConnection(userId);
      }
      pc[userId].addStream(localStream);
      pc[userId].createOffer(function(desc) {
        // desc.sdp = cleanupSdp(desc.sdp);
        pc[userId].setLocalDescription(desc, function() {
          self.sendMessage(userId, {type: "offer", offer: desc});
        }, logError);
      }, logError, {}); // Constraits as second param might need fleshing out
    },
    createPeerConnection: function(userId)
    {
      if(pc[userId]) {
        console.log('WARNING creating PC connection even though one exists', userId);
      }
      pc[userId] = new RTCPeerConnection(pc_config);
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
      /*
      pc[userId].onnsignalingstatechange = function(event) {
        console.log('onsignalingstatechange;', event);
      };
      pc[userId].oniceconnectionstatechange = function(event) {
        if (event.target.iceConnectionState == 'disconnected'
            || event.target.iceConnectionState == 'closed') {
          console.log('hangup due to iceConnectionState', event.target.iceConnectionState);
          self.hangup(userId, false);
        }
      };
      */
    },

    getUserMedia: function()
    {
      // Setup Camera and Microphone
      var mediaConstraints = {
        audio: true,
        video: true
      };

      navigator.mediaDevices
        .getUserMedia(mediaConstraints)
        .then(function(stream){
          localStream = stream;
          self.setStream(self._pad.getUserId(), stream);
          self._pad.collabClient.getConnectedUsers().forEach(function(user) {
            if (user.userId != self.getUserId()) {
              if (pc[user.userId]) {
                self.hangup(user.userId);
              }
              self.call(user.userId);
            }
          });
        })
        .catch(e => logError(e, `getUserMedia() error: ${e.name}`)
      );

    },
    avInURL: function(){
      if (window.location.search.indexOf('av=YES') > -1) {
        return true;
      } else {
        return false;
      }
    },
    init: function(pad)	
    {
      self._pad = pad || window.pad;
      var rtcEnabled = padcookie.getPref("rtcEnabled");
      if (typeof rtcEnabled == 'undefined') {
        rtcEnabled = $('#options-enablertc').prop('checked');
      }

      // if a URL Parameter is set then activate
      if(self.avInURL()) self.activate();

      if(clientVars.webrtc.listenClass){
        $(clientVars.webrtc.listenClass).on('click', function(){
          self.activate();
        });
      }
 
      if(clientVars.webrtc.enabled){
        if (rtcEnabled) {
          self.activate();
        } else {
          self.deactivate();
        }
      }
      $('#options-enablertc').on('change', function() {
        if (this.checked) {
          self.activate()
        } else {
          self.deactivate()
        }
      })
      if (isActive) {
        $(window).unload(function () {
          self.hangupAll();
        });
      }
    }
  }

  var attachMediaStream = null;
  var reattachMediaStream = null;


  // Attach a media stream to an element.
  attachMediaStream = function(element, stream) {
    if (typeof element.srcObject !== 'undefined') {
      element.srcObject = stream;
    } else if (typeof element.srcObject !== 'undefined') {
      element.srcObject = stream;
    }
  };

  reattachMediaStream = function(to, from){
    to.srcObject = from.srcObject;
  };

  function logError(error) {
    console.log('WebRTC ERROR:', error);
  }
  self.pc = pc;
  return self;
}());

exports.rtc = rtc;

