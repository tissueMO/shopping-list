import getpass
import secrets

import gpsoauth


def main() -> None:
    """Google Keep接続用のマスタートークンと端末IDを発行します。"""
    print("oauth_token Cookieの取得用ページ:")
    print("https://accounts.google.com/EmbeddedSetup")
    print(
        "ログイン後、ブラウザーの開発者ツールから"
        "oauth_token Cookieの値を取得してください。"
    )

    email = input("Googleアカウントのメールアドレス: ").strip()
    oauth_token = getpass.getpass("oauth_token Cookieの値: ").strip()
    device_id = secrets.token_hex(8)
    result = gpsoauth.exchange_token(email, oauth_token, device_id)
    master_token = result.get("Token")
    if not master_token:
        error = result.get("Error", "原因不明")
        raise RuntimeError(f"マスタートークンを取得できませんでした: {error}")

    print("次の値を、環境変数に設定してください。")
    print(f"KEEP_EMAIL={email}")
    print(f"KEEP_MASTER_TOKEN={master_token}")
    print(f"KEEP_DEVICE_ID={device_id}")


if __name__ == "__main__":
    main()
