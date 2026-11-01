"""AES-256-GCM + PBKDF2-SHA256 envelope, compatible with the app's WebCrypto decryptor."""
import base64
import gzip
import json
import secrets
from datetime import datetime, timezone

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 210_000


def _key(passphrase: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt_json(obj, passphrase: str) -> dict:
    salt = secrets.token_bytes(16)
    iv = secrets.token_bytes(12)
    plain = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    ct = AESGCM(_key(passphrase, salt, ITERATIONS)).encrypt(iv, plain, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return {
        "v": 1,
        "iter": ITERATIONS,
        "salt": b64(salt),
        "iv": b64(iv),
        "ct": b64(ct),
        "gz": True,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def decrypt_json(env: dict, passphrase: str):
    raw = lambda s: base64.b64decode(s)  # noqa: E731
    plain = AESGCM(_key(passphrase, raw(env["salt"]), int(env["iter"]))).decrypt(raw(env["iv"]), raw(env["ct"]), None)
    if env.get("gz"):
        plain = gzip.decompress(plain)
    return json.loads(plain.decode("utf-8"))
