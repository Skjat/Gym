#!/usr/bin/env python3
"""One-time Garmin login on your computer (supports 2FA). Prints tokens for the GARMIN_TOKENS secret.

    pip install -r requirements.txt
    python login.py
"""
import getpass

from garminconnect import Garmin


def main() -> None:
    email = input("Email Garmin Connect: ").strip()
    password = getpass.getpass("Пароль: ")
    g = Garmin(email=email, password=password, prompt_mfa=lambda: input("Код 2FA из письма/приложения: ").strip())
    g.login()
    print("\nВход выполнен. Скопируйте строку ниже целиком в секрет GARMIN_TOKENS (Settings → Secrets → Actions):\n")
    print(g.client.dumps())
    print("\nНикому не показывайте эту строку — она даёт доступ к вашему аккаунту Garmin.")


if __name__ == "__main__":
    main()
