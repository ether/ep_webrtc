ep_webrtc
=========

WebRTC based audio/video chat for your documents.
This plugin creates an audio/video chat with all
active users of the pad using WebRTC.

# installing

    to get current version:

        npm install ep_webrtc

    to get latest version form git:

        npm install https://github.com/bit/ep_webrtc
    or
        npm install https://r-w-x.org/ep_webrtc

## Post installation

You should use a STUN/TURN server to ensure consistant connecivty between clients.  See STUN/TURN in settings. 

# settings

To disable the chat by default, append this to your settings.json:

   `"ep_webrtc" : {
    "enabled" : false
}`

To set a custom stun server, set `ep_webrtc.iceServer` in your settings.json:

  `"ep_webrtc" : {
"iceServers":[
    {"url": "stun:stun.l.google.com:19302"}
]
}`

To ensure reliable connectivity we recommend setting both a STUN and TURN server.  We don't set this by default and below are just example servers, you should ensure you use reliable STUN and TURN servers.

  `"ep_webrtc" : {
  "iceServers":[
    {
      "urls": [ "stun:216.246.6.224:3478", "stun:74.125.140.127:19302", "stun:[2a00:1450:400c:c08::7f]:19302" ]
    }
      ,
    {
      "urls": [ "turn:numb.viagenie.ca" ],
      "credential": "muazkh",
      "username": "webrtc@live.com"
    },
    {
      "urls": ["turn:192.158.29.39:3478?transport=udp"],
      "credential": "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
      "username": "28224511:1379330808"
    }

    ],
}
`

To set an element or class to listen for an init event set `ep_webrtc.listenClass` in your settings.json.  This is often stabled with ``"enabled":false`` and a button to provide a button to begin video sessions

  `"ep_webrtc" : {
"listenClass": "#chatLabel"
}`

To enable webrtc with a URL parameter append the following to your pad URL ``?av=YES``

# contributing

Please submit bug reports or patches at https://github.com/bit/ep_webrtc/issues
or send them to ep_webrtc@lists.mailb.org

