import contextlib
import io
import unittest
from unittest.mock import patch

import get_master_token


class GetMasterTokenTest(unittest.TestCase):
    """Google Keep接続設定の発行結果を検証します。"""

    EMAIL = "user@example.com"
    OAUTH_TOKEN = "oauth2_4/example-secret-token"
    DEVICE_ID = "0123456789abcdef"
    MASTER_TOKEN = "master-secret-token"

    @patch("get_master_token.gpsoauth.perform_master_login")
    @patch("get_master_token.gpsoauth.exchange_token", create=True)
    @patch("get_master_token.secrets.token_hex")
    @patch("get_master_token.getpass.getpass")
    @patch("builtins.input")
    def test_main_prints_keep_settings_from_oauth_token(
        self,
        input_mock,
        getpass_mock,
        token_hex_mock,
        exchange_token_mock,
        perform_master_login_mock,
    ) -> None:
        """OAuthトークンから発行した設定値を表示します。"""
        input_mock.return_value = self.EMAIL
        getpass_mock.return_value = self.OAUTH_TOKEN
        token_hex_mock.return_value = self.DEVICE_ID
        exchange_token_mock.return_value = {"Token": self.MASTER_TOKEN}
        perform_master_login_mock.side_effect = AssertionError(
            "アプリパスワードによる認証を呼び出してはいけません"
        )
        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            get_master_token.main()

        exchange_token_mock.assert_called_once_with(
            self.EMAIL,
            self.OAUTH_TOKEN,
            self.DEVICE_ID,
        )
        perform_master_login_mock.assert_not_called()
        self.assertIn(
            "https://accounts.google.com/EmbeddedSetup",
            output.getvalue(),
        )
        self.assertIn(
            "環境変数や秘密情報管理機能など",
            output.getvalue(),
        )
        self.assertNotIn(".envへ設定", output.getvalue())
        self.assertIn(f"KEEP_EMAIL={self.EMAIL}", output.getvalue())
        self.assertIn(
            f"KEEP_MASTER_TOKEN={self.MASTER_TOKEN}",
            output.getvalue(),
        )
        self.assertIn(f"KEEP_DEVICE_ID={self.DEVICE_ID}", output.getvalue())

    @patch("get_master_token.gpsoauth.perform_master_login")
    @patch("get_master_token.gpsoauth.exchange_token", create=True)
    @patch("get_master_token.secrets.token_hex")
    @patch("get_master_token.getpass.getpass")
    @patch("builtins.input")
    def test_main_reports_error_without_secret_values(
        self,
        input_mock,
        getpass_mock,
        token_hex_mock,
        exchange_token_mock,
        perform_master_login_mock,
    ) -> None:
        """認証失敗時は機密値を伏せてGoogleのエラー理由を返します。"""
        input_mock.return_value = self.EMAIL
        getpass_mock.return_value = self.OAUTH_TOKEN
        token_hex_mock.return_value = self.DEVICE_ID
        exchange_token_mock.return_value = {"Error": "BadAuthentication"}
        perform_master_login_mock.side_effect = AssertionError(
            "アプリパスワードによる認証を呼び出してはいけません"
        )
        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, "BadAuthentication") as error:
                get_master_token.main()

        message = f"{output.getvalue()}\n{error.exception}"
        exchange_token_mock.assert_called_once_with(
            self.EMAIL,
            self.OAUTH_TOKEN,
            self.DEVICE_ID,
        )
        self.assertNotIn(self.OAUTH_TOKEN, message)
        self.assertNotIn(self.DEVICE_ID, message)
        perform_master_login_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
