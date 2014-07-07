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

To set an element or class to listen for an init event set `ep_webrtc.listenClass` in your settings.json.  This is often stabled with ``"enabled":false`` and a button to provide a button to begin video sessions

  `"ep_webrtc" : {
"listenClass": "#chatLabel"
}`


# contributing

Please submit bug reports or patches at https://github.com/bit/ep_webrtc/issues
or send them to ep_webrtc@lists.mailb.org

