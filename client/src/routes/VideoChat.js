/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import {
  GridList,
  GridListTile,
  GridListTileBar,
  IconButton,
} from "@material-ui/core";
import MyToolTip from "./MyToolTip";
import useWindowDimensions from "../hooks/useWindowDimensions";
import PartnerVideo from "./PartnerVideo";
import { useAuth0 } from "@auth0/auth0-react";

const Room = (props) => {
  const { isAuthenticated, loginWithRedirect, isLoading, user } = useAuth0();
  const hangUpAudio = new Audio("/sounds/hangupsound.mp3");
  const joinInAudio = new Audio("/sounds/joinsound.mp3");

  // dynamic width of webpage
  const { width } = useWindowDimensions();
  const [peers, setPeers] = useState([]);
  const [videoMuted, setVideoMuted] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [screenShared, setScreenShared] = useState(false);
  const socketRef = useRef();
  const userVideo = useRef();
  const userStream = useRef();
  const audioTrack = useRef();
  const videoTrack = useRef();
  const tmpTrack = useRef();
  const screenTrack = useRef();
  const peersRef = useRef([]); // array of peer objects
  const roomID = props.match.params.roomID;

  // when a user presses the back button, disconnect the socket
  window.onpopstate = () => {
    if (userStream.current)
      userStream.current.getTracks().forEach((track) => track.stop());
      socketRef.current.disconnect();
      window.location.reload();
  };

  useEffect(() => {
      if (!isLoading){
        if (!isAuthenticated){
          alert("You are not logged in and will be redirected to the home page after login. Please log in and join again.")
          loginWithRedirect({
            redirectUri: window.location.origin
          })
        }
        else{
          if (!props.location.state){
            alert("You cannot visit this page directly. Please head over to the videochat's home page to start a new meeting or join an existing one. After you click ok, you will be redirected to the home page.")
            window.location.href = window.location.origin;
          }
          else{
                // play the join in sound
            joinInAudio.play();
        
            setTimeout(() => {
              socketRef.current = io.connect("/"); // connecting with the socket.io server
              navigator.mediaDevices
                .getUserMedia({ video: true, audio: true })
                .then((myStream) => {
                  // show this alert to every user who joins the chat
                  userStream.current = myStream;
                  videoTrack.current = userStream.current.getTracks()[1];
                  audioTrack.current = userStream.current.getTracks()[0];
                  userVideo.current.srcObject = myStream;
        
                  socketRef.current.emit("join room", {room: roomID, userIdentity: "name" in user ? user.name : user.email});
        
                  // this is received by the user who just joined
                  // we get all the users present in the room
                  socketRef.current.on("all other users", (partners) => {
                    // create a peer for us corresponding to connection to every other user in the room
                    partners.forEach((partnerId) => {
                      const peer = createPeer(partnerId, myStream);
                      peersRef.current.push({
                        peerID: partnerId, // this particular peer is representing conection b/w me and partnerId
                        userIdentity: "Loading...",
                        peer,
                      });
                    });
                    setPeers([...peersRef.current]); // update the state to render their streams
                  });
        
                  // this event is received by a user who is already present within the room
                  // so we need to add peer corresponding to the new comer
                  // we are also receiving peer signal(offer) from new comer
                  socketRef.current.on("user joined", (payload) => {
                    const peer = addPeer(payload.signal, payload.callerID, myStream);
                    peersRef.current.push({
                      peerID: payload.callerID,
                      userIdentity: payload.userIdentity,
                      peer, // this is equivalent to peer: peer
                    });
        
                    // add new peerobj to peers state
                    setPeers([...peersRef.current]);
                    alert(`${payload.userIdentity} joined the meeting.`)
                  });
        
                  // now the peer who has joined just now is receiving the retrned signal
                  // from the peers to whom it had sent signal to
                  socketRef.current.on("answer", (payload) => {
                    // finding the corresponding peer which is item.peer
                    peersRef.current.find(
                      (p, index) => {
                        if (p.peerID === payload.id){
                          peersRef.current[index].userIdentity = payload.userIdentity;
                          p.peer.signal(payload.signal); // accepting the returned signal
                          return true;
                        }
                        return false;
                      }
                    )
                    // this completes the handshake
                    setPeers([...peersRef.current]);
                  });
        
                  socketRef.current.on("user left", payload => {
                    const userId = payload.id;
                    const alias = payload.alias;
                    const peerObj = peersRef.current.find((p) => p.peerID === userId);
                    if (peerObj) {
                      // remove all the connections and event handlers associated with this peer
                      peerObj.peer.destroy();
                    }
                    const peers = peersRef.current.filter((p) => p.peerID !== userId); // removing this userId from peers
        
                    // update peersRef
                    peersRef.current = peers;
        
                    alert(`${alias} left the meeting.`)
                    // also update the state to remove the left user's video from screen
                    setPeers(peers);
                  });
                })
                .catch((err) => console.log(err));
            }, 1000);
          }
        }
      }
  }, [isLoading]);
  function createPeer(partnerId, myStream) {
    // If I am joining the room, I am the initiator
    const peer = new Peer({
      initiator: true,
      trickle: false,
      config: {
        iceServers: [
          {
            urls: "stun:stun.stunprotocol.org",
          },
          {
            urls: "turn:100.25.34.119:3478?transport=tcp",
            username: "kurento",
            credential: "kurento",
          },
        ],
      },
    });

    if (audioTrack.current) peer.addTrack(audioTrack.current, myStream);
    if (videoTrack.current) peer.addTrack(videoTrack.current, myStream);

    // since here initiator is true, whenever peer is created it signals
    // and the below function gets called
    peer.on("signal", (signal) => {
      socketRef.current.emit("offer", {
        userToSignal: partnerId,
        userIdentity: "name" in user ? user.name : user.email,
        callerID: socketRef.current.id,
        signal,
      });
    });

    return peer;
  }

  function addPeer(incomingSignal, callerID, myStream) {
    // since I am receiving the offer, initiator = false
    const peer = new Peer({
      initiator: false,
      trickle: false,
      config: {
        iceServers: [
          {
            urls: "stun:stun.stunprotocol.org",
          },
          {
            urls: "turn:100.25.34.119:3478?transport=tcp",
            username: "kurento",
            credential: "kurento",
          },
        ],
      },
    });

    if (audioTrack.current) peer.addTrack(audioTrack.current, myStream);
    if (videoTrack.current) peer.addTrack(videoTrack.current, myStream);

    // here initiator is false,
    // so the below event is fired only when our peer accepts the incomingSignal
    // i.e peer.signal(incomingSignal) will fire the below function
    peer.on("signal", (signal) => {
      socketRef.current.emit("answer", { signal, callerID, userIdentity: "name" in user ? user.name : user.email });
    });

    peer.signal(incomingSignal);

    return peer;
  }

  const shareScreen = () => {
    navigator.mediaDevices.getDisplayMedia({ cursor: true }).then((stream) => {
      setScreenShared(true);

      // store the video track i.e. our web cam stream into tmpTrack
      // and replace the video track with our screen track
      // so that it will be streamed on our screen as well as to our remote peers
      userVideo.current.srcObject = stream;
      screenTrack.current = stream.getTracks()[0];
      tmpTrack.current = videoTrack.current;
      videoTrack.current = screenTrack.current;

      peersRef.current.forEach((peerObj) => {
        peerObj.peer.replaceTrack(
          tmpTrack.current, // prev video track - webcam
          videoTrack.current, // current video track - screen track
          userStream.current
        );
      });

      screenTrack.current.onended = () => {
        stopShareScreen();
      };
    });
  };

  const stopShareScreen = () => {
    setScreenShared(false);

    // restore the videoTrack which was stored earlier in tmpTrack when screensharing was turned on
    videoTrack.current = tmpTrack.current;

    // stop the screentrack
    screenTrack.current.stop();

    // reassign our stream to the prev stream i.e. to that consisting of webcam video and audio
    userVideo.current.srcObject = userStream.current;

    // replace the screenTrack with videotrack for each remote peer
    peersRef.current.forEach((peerObj) => {
      peerObj.peer.replaceTrack(
        screenTrack.current,
        videoTrack.current,
        userStream.current
      );
    });
  };

  const endCall = () => {
    // play the call ending sound
    hangUpAudio.play();

    // stop all tracks - audio and video
    userStream.current.getTracks().forEach((track) => track.stop());
    socketRef.current.disconnect();
    props.history.push("/videochat");
  };

  const muteVideo = () => {
    if (userVideo.current.srcObject) {
      if (!screenShared) {
        videoTrack.current.enabled = !videoTrack.current.enabled;
      }
    }
    setVideoMuted((prevStatus) => !prevStatus);
  };

  const muteAudio = () => {
    if (userVideo.current.srcObject) {
      audioTrack.current.enabled = !audioTrack.current.enabled;
    }
    setAudioMuted((prevStatus) => !prevStatus);
  };

  if (!props.location.state) return <div id="room"></div>
  return (
    <div id="room">
      <div id="grid-root">
        <GridList cellHeight="90vh" id="grid-list" cols={2} spacing={20}>
          <GridListTile
            key="1"
            cols={peers.length === 0 || screenShared ? 2 : 1}
            rows={2}
          >
            <video
              id="mine"
              muted
              controls
              ref={userVideo}
              autoPlay
              playsInline
            />
            <style jsx>
              {`
                #mine {
                  transform: ${screenShared
                    ? "rotateY(0deg)"
                    : "rotateY(180deg)"};
                }

                #mine::-webkit-media-controls-panel {
                  transform: ${screenShared
                    ? "rotateY(0deg)"
                    : "rotateY(180deg)"};
                }
              `}
            </style>
            <GridListTileBar title="You" titlePosition="top" />
          </GridListTile>
          {peers.map((peerObj) => {
            return (
              <GridListTile key={peerObj.peerID} cols={1} rows={2}>
                <PartnerVideo
                  key={peerObj.peerID}
                  peer={peerObj.peer}
                  user={peerObj.peerID}
                />
                <GridListTileBar
                  title={peerObj.userIdentity}
                  titlePosition="top"
                  actionPosition="right"
                />
              </GridListTile>
            );
          })}
        </GridList>
      </div>
      <nav id="video-controls">
        <h3 style={{ position: "absolute", left: `${width < 600 ? 7 : 20}px`, fontSize: "auto" }}>
          {new Date().toLocaleString("en-US", {
            hour12: true,
            hour: "numeric",
            minute: "numeric",
          })}
        </h3>
        <div style={{ position: "absolute", left: `${width < 770 ? width * 30 / 100 : width * 41 / 100}px` }}>
          {!screenShared && (
            <MyToolTip
              title={userStream.current ? (videoMuted ? "Turn on Camera" : "Turn off Camera") : "Loading..."}
            >
              <IconButton
                onClick={() => {
                  // if video stream exists
                  if (userStream.current){
                    muteVideo();
                  }
                }}
                style={{
                  backgroundColor: videoMuted ? "#eb3f21" : "#404239",
                  margin: `${width < 600 ? 2 : 4}px`,
                }}
              >
                {videoMuted ? (
                  <span
                    className="material-icons-outlined"
                    style={{ color: "white" }}
                  >
                    videocam_off
                  </span>
                ) : (
                  <span
                    className="material-icons-outlined"
                    style={{ color: "white" }}
                  >
                    videocam
                  </span>
                )}
              </IconButton>
            </MyToolTip>
          )}

          <MyToolTip
            title={userStream.current ? (audioMuted ? "Turn on Microphone" : "Turn off Microphone"): "Loading..."}
          >
            <IconButton
              onClick={() => {
                // if audio stream exists
                if (userStream.current){
                  muteAudio();
                }
              }}
              style={{
                backgroundColor: audioMuted ? "#eb3f21" : "#404239",
                margin: `${width < 600 ? 2 : 4}px`
              }}
            >
              {audioMuted ? (
                <span className="material-icons" style={{ color: "white" }}>
                  mic_off
                </span>
              ) : (
                <span className="material-icons" style={{ color: "white" }}>
                  mic
                </span>
              )}
            </IconButton>
          </MyToolTip>

          <MyToolTip title={userStream.current ? (screenShared ? "Stop Presenting" : "Present Now") : "Loading..."}>
            <IconButton
              onClick={() => {
                // wait for stream to load first
                if (userStream.current){
                  if (screenShared) stopShareScreen();
                  else shareScreen();
                }
              }}
              style={{
                backgroundColor: screenShared ? "#8eb2f5" : "#404239",
                margin: `${width < 600 ? 2 : 4}px`
              }}
            >
              {screenShared ? (
                <span className="material-icons" style={{ color: "black" }}>
                  cancel_presentation
                </span>
              ) : (
                <span className="material-icons" style={{ color: "white" }}>
                  present_to_all
                </span>
              )}
            </IconButton>
          </MyToolTip>

          <MyToolTip title="Leave Call">
            <IconButton
              onClick={endCall}
              style={{ backgroundColor: "#eb3f21", margin: `${width < 600 ? 2 : 4}px` }}
            >
              <span className="material-icons" style={{ color: "white" }}>
                call_end
              </span>
            </IconButton>
          </MyToolTip>
        </div>
        <h5 style={{ position: "absolute", right: (width / 100) * 3 }}>
        <MyToolTip title="Copy meeting Room">
            <IconButton
              onClick={() => {
                navigator.clipboard.writeText(roomID);
                alert("Meeting Room copied to clipboard. Paste it in the videochat home page to join the call.")
              }}
              style={{ backgroundColor: "#404239", margin: `${width < 600 ? 2 : 4}px` }}
            >
              <span className="material-icons" style={{ color: "white" }}>
                content_copy
              </span>
            </IconButton>
          </MyToolTip>
        </h5>
      </nav>
    </div>
  );
};

export default Room;