/**
 * Resolve the base URL of the call/WebRTC media service. Prefers the
 * LiveKit WSS URL (LIVEKIT_URL), then CALL_SERVICE_URL, then the API URL.
 */
export const getCallServiceUrl = (): string => {
  return (
    process.env.LIVEKIT_URL?.trim() ||
    process.env.CALL_SERVICE_URL?.trim() ||
    process.env.API_URL?.trim() ||
    ""
  );
};
