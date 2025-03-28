"use client";

import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { interviewer } from "@/constants";
import { createFeedback } from "@/lib/actions/general.action";
import CallHint from "@/components/CallHint";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

interface SavedMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
  userAvatar,
}: AgentProps) => {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>("");
  const [showCallHint, setShowCallHint] = useState(true);
  const [lastActivityTimestamp, setLastActivityTimestamp] = useState<number>(Date.now());
  const INACTIVITY_TIMEOUT = 30000; // 30 seconds of inactivity will end the call

  // Use useCallback to memoize the function
  const handleDisconnect = useCallback(() => {
    setCallStatus(CallStatus.FINISHED);
    vapi.stop();
  }, []);
  
  // Inactivity monitor
  useEffect(() => {
    if (callStatus !== CallStatus.ACTIVE) return;
    
    const inactivityTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastActivityTimestamp > INACTIVITY_TIMEOUT) {
        console.log("Inactivity timeout reached, ending call");
        handleDisconnect();
      }
    }, 5000); // Check every 5 seconds
    
    return () => clearInterval(inactivityTimer);
  }, [callStatus, lastActivityTimestamp, handleDisconnect, INACTIVITY_TIMEOUT]);
  
  // VAPI event handlers
  useEffect(() => {
    const onCallStart = () => {
      setCallStatus(CallStatus.ACTIVE);
      setLastActivityTimestamp(Date.now()); // Update timestamp on call start
    };

    const onCallEnd = () => {
      setCallStatus(CallStatus.FINISHED);
    };

    const onMessage = (message: Message) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        setLastActivityTimestamp(Date.now()); // Update timestamp when message received
        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [...prev, newMessage]);
      }
    };

    const onSpeechStart = () => {
      console.log("Speech start!");
      setLastActivityTimestamp(Date.now()); // Update timestamp when speech starts
      setIsSpeaking(true);
    };

    const onSpeechEnd = () => {
      console.log("Speech end!");
      setIsSpeaking(false);
    };

    const onError = (error: Error) => {
      console.log("Error:", error);
      
      // More robust error handling for meeting ended errors
      if (
        (typeof error === 'object' && error !== null) && 
        (
          // Check various possible error message formats
          (error.message && error.message.includes("Meeting has ended")) ||
          (error.toString().includes("Meeting has ended")) ||
          (JSON.stringify(error).includes("Meeting has ended"))
        )
      ) {
        console.log("Detected meeting end, transitioning to FINISHED state");
        setCallStatus(CallStatus.FINISHED);
        vapi.stop(); // Ensure VAPI is properly stopped
      }
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
    };
  }, []); // Empty dependency array - only run once

  // Handle messages and call status changes
  useEffect(() => {
    if (messages.length > 0) {
      setLastMessage(messages[messages.length - 1].content);
    }

    const handleGenerateFeedback = async (messages: SavedMessage[]) => {
      console.log("handleGenerateFeedback");

      const { success, feedbackId: id } = await createFeedback({
        interviewId: interviewId!,
        userId: userId!,
        transcript: messages,
        feedbackId,
      });

      if (success && id) {
        router.push(`/interview/${interviewId}/feedback`);
      } else {
        console.log("Error saving feedback");
        router.push("/");
      }
    };

    if (callStatus === CallStatus.FINISHED) {
      if (type === "generate") {
        router.push("/");
      } else {
        handleGenerateFeedback(messages);
      }
    }
  }, [messages, callStatus, feedbackId, interviewId, router, type, userId]);

  const handleCall = async () => {
    setCallStatus(CallStatus.CONNECTING);

    if (type === "generate") {
      await vapi.start(process.env.NEXT_PUBLIC_VAPI_WORKFLOW_ID!, {
        variableValues: {
          username: userName,
          userid: userId,
        },
      });
    } else {
      let formattedQuestions = "";
      if (questions) {
        formattedQuestions = questions
          .map((question) => `- ${question}`)
          .join("\n");
      }

      await vapi.start(interviewer, {
        variableValues: {
          questions: formattedQuestions,
        },
      });
    }
  };

    return (
        <>
        <div className="call-view">
            {/* AI Interviewer Card */}
            <div className="card-interviewer">
                <div className="avatar">
                    <Image src="/ai-avatar-512.png" alt="AI Avatar" width={110} height={110} className="object-cover" />
                    {isSpeaking && <span className="animate-speak" />}
                </div>
                <h3>AI Interviewer</h3>
            </div>

        {/* User Profile Card */}
        <div className="card-border">
          <div className="card-content">
            <Image
              src={userAvatar || "/user-avatar.jpg"}
              alt="profile-image"
              width={539}
              height={539}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="transcript-border">
          <div className="transcript">
            <p
              key={lastMessage}
              className={cn(
                "transition-opacity duration-500 opacity-0",
                "animate-fadeIn opacity-100"
              )}
            >
              {lastMessage}
            </p>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center relative">
        {callStatus === CallStatus.INACTIVE && showCallHint && (
          <CallHint 
            targetId="call-button"
            timeoutDuration={10000}
            text={type === "generate" ? "Click CALL to generate the interview" : "Click CALL to start the interview"}
            onDismiss={() => setShowCallHint(false)}
          />
        )}
        
        {callStatus !== "ACTIVE" ? (
          <button 
            id="call-button" 
            className="relative btn-call" 
            onClick={() => handleCall()}
          >
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== "CONNECTING" && "hidden"
              )}
            />

            <span className="relative">
              {callStatus === "INACTIVE" || callStatus === "FINISHED"
                ? "Call"
                : ". . ."}
            </span>
          </button>
        ) : (
          <button className="btn-disconnect cursor-pointer" onClick={() => handleDisconnect()}>
            End
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;
