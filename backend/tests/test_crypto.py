import base64
import unittest

from app.core.crypto import AesGcmCipher, CryptoError


class AesGcmCipherTests(unittest.TestCase):
    def setUp(self) -> None:
        key = base64.b64encode(bytes(range(32))).decode("ascii")
        self.cipher = AesGcmCipher(key)

    def test_encrypt_uses_unique_iv_and_round_trips_plaintext(self) -> None:
        plain = "api-key-example"

        first = self.cipher.encrypt(plain)
        second = self.cipher.encrypt(plain)

        self.assertNotEqual(first, second)
        self.assertNotEqual(first, plain)
        self.assertNotEqual(second, plain)
        self.assertEqual(self.cipher.decrypt(first), plain)
        self.assertEqual(self.cipher.decrypt(second), plain)

    def test_decrypt_rejects_a_tampered_ciphertext(self) -> None:
        encrypted = bytearray(base64.b64decode(self.cipher.encrypt("api-key-example")))
        encrypted[-1] ^= 1
        tampered = base64.b64encode(encrypted).decode("ascii")

        with self.assertRaises(CryptoError):
            self.cipher.decrypt(tampered)

    def test_rejects_invalid_key_and_ciphertext(self) -> None:
        short_key = base64.b64encode(bytes(range(31))).decode("ascii")

        with self.assertRaises(CryptoError):
            AesGcmCipher(short_key)
        with self.assertRaises(CryptoError):
            self.cipher.decrypt("not valid base64!")


if __name__ == "__main__":
    unittest.main()
