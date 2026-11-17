# End-to-End Encrypted Chat — Frontend Integration Guide

This server now supports **optional, client-side** end-to-end (E2E) encryption for 1:1 chat.
The server never holds private keys and never decrypts messages: it only stores and relays ciphertext.

> Legacy (plaintext) messages continue to work. Encryption is opt-in per message via
> `encryptionVersion`. A message is either plaintext (`encryptionVersion = null`) or
> encrypted (`encryptionVersion` set); do not send both plaintext `content` and ciphertext.

## 1. Key model

- Each **device** has its own keypair (recommended: X25519).
- Private key: generated on-device, stored in secure storage (Keychain/Keystore). **Never sent to the server.**
- Public key: registered with the server per device.
- Recovery: the client must implement a recovery flow (passphrase / recovery code / backup).
  Lost private key = previously encrypted messages are unrecoverable.

## 2. Registering a device public key

Use the existing device registration endpoint:

```
POST /devices/register
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceId": "ios-<uuid>",
  "platform": "IOS",
  "publicKey": "<base64 X25519 public key>",
  "keyVersion": 1
}
```

- `publicKey` / `keyVersion` are optional and additive; omitting them preserves the stored key.
- Re-register (or call again with a higher `keyVersion`) to rotate a key.
- The server stores `publicKey`, `keyVersion`, `keyUpdatedAt` on `UserDevice`.

## 3. Fetching a recipient's keys

```
GET /devices/users/:userId/encryption-keys
Authorization: Bearer <token>
```

Response:

```json
{
  "userId": "<uuid>",
  "keys": [
    {
      "id": "<uuid>",
      "deviceId": "ios-<uuid>",
      "platform": "IOS",
      "publicKey": "<base64>",
      "keyVersion": 1,
      "keyUpdatedAt": "2026-...",
      "enabled": true
    }
  ]
}
```

Use these public keys to derive a shared secret with each recipient device.

## 4. Sending an encrypted message

```
POST /messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "receiverId": "<uuid>",
  "type": "TEXT",
  "ciphertext": "<base64 AES-256-GCM ciphertext>",
  "nonce": "<base64 nonce/IV>",
  "aad": "<optional base64 additional authenticated data>",
  "encryptionVersion": 1
}
```

- `content` must be omitted for encrypted messages.
- `mediaUrl` may still be provided for encrypted media (see §6).
- The server stores `ciphertext`, `nonce`, `aad`, `encryptionVersion` and sets `content = null`.
- `conversation.lastMessage` becomes the opaque string `"🔒 Encrypted message"`.

Validation rules (server-side):
- If `encryptionVersion` is present, `ciphertext` and `nonce` are required.
- Otherwise the existing plaintext rules apply (`content` required for `TEXT`, `mediaUrl` for `IMAGE`/`VIDEO`).

## 5. Reading messages

`GET /messages/conversations/:conversationId` returns each message including:

```json
{
  "id": "...",
  "type": "TEXT",
  "content": null,
  "ciphertext": "<base64>",
  "nonce": "<base64>",
  "aad": "<base64|null>",
  "encryptionVersion": 1,
  "mediaUrl": null,
  "createdAt": "..."
}
```

- If `encryptionVersion` is `null`: render `content` as before (legacy plaintext).
- If `encryptionVersion` is set: decrypt `ciphertext` with the shared key derived from
  your private key + the sender's public key for that `encryptionVersion`.

Socket.IO events (`new_message`, `message_sent`) carry the same stored payload, so
real-time messages are already ciphertext.

## 6. Encrypted media

1. Encrypt the file client-side (AES-256-GCM or a streaming cipher).
2. Upload the ciphertext using the existing upload flow; store the returned URL in `mediaUrl`.
3. Send the message with `mediaUrl` + encryption fields.
4. On receive, download from `mediaUrl` and decrypt client-side.

The server stores only the opaque media URL and bytes.

## 7. Recommended crypto flow (1:1)

1. Generate an X25519 keypair per device.
2. Register the public key (§2).
3. To send to a recipient:
   - Fetch recipient device keys (§3).
   - Derive a shared secret: `X25519(senderPrivateKey, recipientPublicKey)`.
   - Derive an AES key via HKDF-SHA256 (include a context string + key version).
   - Encrypt with AES-256-GCM; send `ciphertext`, `nonce`, `aad`, `encryptionVersion`.
4. To receive: use your private key + the sender's public key to derive the same AES key, then decrypt.

> **Multi-device note:** the server stores a single ciphertext per message. If a recipient
> has multiple devices, either (a) use a shared conversation key distributed to each device,
> or (b) accept that only the device holding the matching private key can read it.
> Supporting full multi-device E2E requires additional key-distribution work beyond this
> change.

## 8. Push notifications

For encrypted messages the server sends a generic preview only:
- `previewBody` / `preview`: `"Encrypted message"`
- No plaintext content is included in the push payload.

Clients should open the conversation to decrypt and display the message.

## 9. Migration / compatibility

- All pre-existing messages have `encryptionVersion = null` and retain plaintext `content`.
- Clients must branch on `encryptionVersion` to decide whether to decrypt.
- The server does not migrate old plaintext messages to ciphertext (it cannot).

## 10. Security notes

- Never log decrypted content or private keys.
- Treat `aad` as authenticated context (e.g. conversation id + message id + key version).
- Rotate keys by incrementing `keyVersion` and re-registering the public key.
- The server still enforces blocking, rate limits, and auth; only confidentiality moves to the client.
