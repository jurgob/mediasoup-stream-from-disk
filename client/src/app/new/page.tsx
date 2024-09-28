"use client";

import { useEffect, useRef, useState } from "react";
// import { css } from "@emotion/css";
import { io } from "socket.io-client";
import { Device } from "mediasoup-client";
import {
  DtlsParameters,
  IceCandidate,
  IceParameters,
  Transport,
} from "mediasoup-client/lib/types";

// type WebRtcTransportCallbackParam= {
//   params:
//     | {
//         /**
//          * A unique identifier generated by mediasoup for the transport.
//          * Necessary for differentiating between multiple transports.
//          */
//         id: string;
//         /**
//          * Interactive Connectivity Establishment (ICE) parameters.
//          * Necessary for the negotiation of network connections.
//          */
//         iceParameters: IceParameters;
//         /**
//          * Array of ICE candidates.
//          * Necessary for establishing network connectivity through NATs and firewalls.
//          */
//         iceCandidates: IceCandidate[];
//         /**
//          * Datagram Transport Layer Security (DTLS) parameters.
//          * Necessary for securing the transport with encryption.
//          */
//         dtlsParameters: DtlsParameters;
//       }
//     | {
//         /** Error object if any error occurs during transport creation. */ error: unknown;
//       };
type WebRtcTransportCallbackParam= {
  params: any
}

export default function Home() {
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);


  const startVideoCall = async () => {
    /**
     * socket event ()
     * --()-> createTransport({ sender: false })
     * <-()-- createTransport({ params: { id, iceParameters, iceCandidates, dtlsParameters } })
     */


    const socket = io("http://localhost:4000/mediasoup");
    //startCamera()
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    if (!videoRef.current) return ;
    const track = stream.getVideoTracks()[0];
    videoRef.current.srcObject = stream;
    const params = { 
      track,
      encoding: [
        { rid: "r0", maxBitrate: 100000, scalabilityMode: "S1T3" }, // Lowest quality layer
        { rid: "r1", maxBitrate: 300000, scalabilityMode: "S1T3" }, // Middle quality layer
        { rid: "r2", maxBitrate: 900000, scalabilityMode: "S1T3" }, // Highest quality layer
      ],
      codecOptions: { videoGoogleStartBitrate: 1000 }, // Initial bitrate
    };
    //getRouterRtpCapabilities()
    const rtcCapabilities = await new Promise((resolve) => {
        socket.emit("getRouterRtpCapabilities", (data: any) => {
            resolve(data.routerRtpCapabilities);
          });
    }) as any;
    
    //createDevice();
    const device = new Device();
    await device.load({ routerRtpCapabilities: rtcCapabilities });
    //createSendTransport();
    const producerTransport = await new Promise((resolve) => {
        socket.emit(
            "createTransport",
            { sender: true },
            ({
              params,
            }: {
              params: {
                id: string;
                iceParameters: IceParameters;
                iceCandidates: IceCandidate[];
                dtlsParameters: DtlsParameters;
                error?: unknown;
              };
            }) => {
              if (params.error) {
                console.log(params.error);
                return;
              }
              let transport = device?.createSendTransport(params);
              transport?.on(
                "connect",
                async ({ dtlsParameters }: any, callback: any, errback: any) => {
                  try {
                    console.log("----------> producer transport has connected");
                    socket.emit("connectProducerTransport", { dtlsParameters });
                    callback();
                  } catch (error) {
                    errback(error);
                  }
                }
              );
      
              transport?.on(
                "produce",
                async (parameters: any, callback: any, errback: any) => {
                  const { kind, rtpParameters } = parameters;
                  try {
                    socket.emit(
                      "transport-produce",
                      { kind, rtpParameters },
                      ({ id }: any) => {
                        // Callback to provide the server-generated producer ID back to the transport
                        callback({ id });
                      }
                    );
                  } catch (error) {
                    // Errback to indicate failure
                    errback(error);
                  }
                }
              );
              
              resolve(transport);
            }
          );
    }) as Transport;

    //connectSendTransport();
    let localProducer = await producerTransport?.produce(params);
    localProducer?.on("trackended", () => {
      console.log("trackended");
    });
    localProducer?.on("transportclose", () => {
      console.log("transportclose");
    });

    //createRecvTransport();
    const consumerTransport = await new Promise((resolve) => {
        socket.emit(
            "createTransport",
            { sender: false },
            ({params}: WebRtcTransportCallbackParam ) => {
              if (params.error) {
                console.log(params.error);
                return;
              }
              let transport = device?.createRecvTransport(params);
               transport?.on(
                "connect",
                async ({ dtlsParameters }: any, callback: any, errback: any) => {
                  try {
                    // Notifying the server to connect the receive transport with the provided DTLS parameters
                    await socket.emit("connectConsumerTransport", { dtlsParameters });
                    console.log("----------> consumer transport has connected");
                    callback();
                  } catch (error) {
                    errback(error);
                  }
                }
              );
              resolve(transport);
            }
          );
    }) as Transport;
    //connectRecvTransport();
    await socket.emit(
        "consumeMedia",
        { rtpCapabilities: device?.rtpCapabilities },
        async ({ params }: any) => {
          if (params.error) {
            console.log(params.error);
            return;
          }
          // Consuming media using the receive transport
          let consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
          });
  
          // Accessing the media track from the consumer
          const { track } = consumer;
          console.log("************** track", track);
  
          // Attaching the media track to the remote video element for playback
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = new MediaStream([track]);
          }
  
          // Notifying the server to resume media consumption
          socket.emit("resumePausedConsumer", () => {});
          console.log("----------> consumer transport has resumed");
        }
      );
  };



  return (
    <main>
      <video ref={videoRef} id="localvideo" autoPlay playsInline />
      <video ref={remoteVideoRef} id="remotevideo" autoPlay playsInline />
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <button onClick={startVideoCall}>
          Start vide call
        </button>
      </div>
    </main>
  );
}
