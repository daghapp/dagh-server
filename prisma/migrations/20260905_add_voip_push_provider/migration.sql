-- Add the VOIP push provider so incoming calls can be delivered as APNs
-- PushKit VoIP pushes (delivered directly to the registered voipPushToken).
ALTER TYPE "PushProvider" ADD VALUE 'VOIP';