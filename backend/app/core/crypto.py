"""AES-256-GCM helpers for encrypted API-key storage."""

import base64
import binascii
import os
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings


class CryptoError(ValueError):
    """Raised when encryption configuration or ciphertext is invalid."""


class AesGcmCipher:
    """Encrypt and decrypt UTF-8 strings with a Base64-encoded AES-256 key."""

    _IV_LENGTH = 12
    _TAG_LENGTH = 16
    _KEY_LENGTH = 32

    def __init__(self, key: str) -> None:
        try:
            decoded_key = base64.b64decode(key, validate=True)
        except (binascii.Error, TypeError, ValueError) as exc:
            raise CryptoError("Invalid AES key configuration") from exc

        if len(decoded_key) != self._KEY_LENGTH:
            raise CryptoError("Invalid AES key configuration")

        self._cipher = AESGCM(decoded_key)

    def encrypt(self, plain: str) -> str:
        iv = os.urandom(self._IV_LENGTH)
        encrypted = self._cipher.encrypt(iv, plain.encode("utf-8"), None)
        return base64.b64encode(iv + encrypted).decode("ascii")

    def decrypt(self, ciphertext: str) -> str:
        try:
            encrypted = base64.b64decode(ciphertext, validate=True)
        except (binascii.Error, TypeError, ValueError) as exc:
            raise CryptoError("Invalid encrypted value") from exc

        if len(encrypted) < self._IV_LENGTH + self._TAG_LENGTH:
            raise CryptoError("Invalid encrypted value")

        try:
            plain = self._cipher.decrypt(encrypted[: self._IV_LENGTH], encrypted[self._IV_LENGTH :], None)
            return plain.decode("utf-8")
        except (InvalidTag, UnicodeDecodeError) as exc:
            raise CryptoError("Invalid encrypted value") from exc


@lru_cache
def get_cipher() -> AesGcmCipher:
    """Create the process-wide cipher only when encryption is requested."""
    return AesGcmCipher(get_settings().aes_key)


def encrypt(plain: str) -> str:
    """Encrypt a UTF-8 string using the configured AES-256 key."""
    return get_cipher().encrypt(plain)


def decrypt(ciphertext: str) -> str:
    """Decrypt a configured AES-256-GCM ciphertext."""
    return get_cipher().decrypt(ciphertext)
