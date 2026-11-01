// libsodium crypto_box_seal, as required by the GitHub "create repository secret" API:
// ephemeral X25519 key, nonce = blake2b(ephemeralPk || recipientPk, 24), XSalsa20-Poly1305.
import nacl from 'tweetnacl';
import { blake2b } from 'blakejs';

export function sealedBox(message: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  const eph = nacl.box.keyPair();
  const nonceInput = new Uint8Array(64);
  nonceInput.set(eph.publicKey, 0);
  nonceInput.set(recipientPk, 32);
  const nonce = blake2b(nonceInput, undefined, 24);
  const boxed = nacl.box(message, nonce, recipientPk, eph.secretKey);
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0);
  out.set(boxed, 32);
  return out;
}

export const toB64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
