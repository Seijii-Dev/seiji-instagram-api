#!/usr/bin/env python3
"""Interactive client for the deployed Instagram API.

The API server performs the Instagram lookup, requester-IP geolocation, and
Telegram notification. This client only sends the username and displays the
formatted response returned by the server.
"""

import json
import re
import sys
from urllib.parse import quote

import requests

API_BASE_URL = "https://seiji-instagram-api.vercel.app"
SEARCH_ENDPOINT = f"{API_BASE_URL}/api/search"
REQUEST_TIMEOUT = 45

RESET = "\033[0m"
BOLD = "\033[1m"
RED = "\033[1m\033[31m"
GREEN = "\033[1m\033[32m"
CYAN = "\033[1m\033[36m"
WHITE = "\033[1m\033[37m"
PINK = "\033[1m\033[38;5;206m"

USERNAME_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,30}")
SESSION = requests.Session()
SESSION.headers.update({
    "Accept": "application/json",
    "User-Agent": "Instagram-API-Client/1.0",
})


def clear() -> None:
    print("\033[2J\033[H", end="")


def banner() -> None:
    clear()
    print(f"{CYAN}{BOLD}INSTAGRAM API CLIENT{RESET}")
    print(f"{PINK}{'=' * 60}{RESET}")
    print(f"{WHITE}API: {API_BASE_URL}{RESET}\n")


def normalize_username(value: str) -> str | None:
    username = value.strip().lstrip("@")
    return username if USERNAME_PATTERN.fullmatch(username) else None


def prompt_username() -> str | None:
    try:
        username = normalize_username(input(f"{WHITE}[+]{RESET} Enter username : "))
    except (EOFError, KeyboardInterrupt):
        print()
        return None

    if username is None:
        print(f"{RED}[-]{RESET} Invalid username. Use 1-30 letters, numbers, dots, underscores, or hyphens.")
    return username


def search_instagram(username: str) -> dict:
    response = SESSION.get(
        SEARCH_ENDPOINT,
        params={"username": username},
        timeout=REQUEST_TIMEOUT,
    )

    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"The API returned invalid JSON (HTTP {response.status_code}).") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("The API returned an unexpected response.")

    return payload


def show_search_result(username: str) -> None:
    try:
        payload = search_instagram(username)
    except requests.RequestException as exc:
        print(f"{RED}[-]{RESET} Request failed: {exc}")
        return
    except RuntimeError as exc:
        print(f"{RED}[-]{RESET} {exc}")
        return

    # The API sends the complete profile + IP report to Telegram. Keep the
    # terminal output focused on Instagram profile data only.
    profile = payload.get("data", {}).get("profile", {})
    if isinstance(profile, dict) and profile:
        print("\n# INSTAGRAM PROFILE")
        print(f"Username        : {profile.get('username', 'N/A')}")
        print(f"Display Name    : {profile.get('full_name', 'N/A')}")
        print(f"User ID         : {profile.get('user_id', 'N/A')}")
        print(f"Bio             : {profile.get('biography', 'N/A')}")
        print(f"Followers       : {int(profile.get('follower_count', 0)):,}")
        print(f"Following       : {int(profile.get('following_count', 0)):,}")
        print(f"Posts           : {int(profile.get('media_count', 0)):,}")
        print(f"Private         : {'Yes' if profile.get('is_private') else 'No'}")
        print(f"Verified        : {'Yes' if profile.get('is_verified') else 'No'}")
        print(f"Account Type    : {profile.get('account_type', 'N/A')}")
        print(f"Joined          : {profile.get('date_joined', 'N/A')}")
        print(f"Threads         : {profile.get('threads_link', 'N/A')}")
        print(f"Facebook ID     : {profile.get('fbid_v2', 'N/A')}")
        print(f"Avatar          : {profile.get('profile_pic_url', 'N/A')}")
        if profile.get("fb_name") not in (None, "N/A") and profile.get("fb_profile_url") not in (None, "N/A"):
            print("\n# LINKED FACEBOOK")
            print(f"Display Name    : {profile.get('fb_name')}")
            print(f"Profile URL     : {profile.get('fb_profile_url')}")
    else:
        print(f"\n{RED}[-]{RESET} Instagram profile not found or unavailable.")

    if payload.get("telegram_sent") is True:
        print(f"\n{GREEN}[+]{RESET} Full result sent to Telegram by the API server.")
    elif payload.get("telegram_sent") is False:
        print(f"\n{RED}[-]{RESET} Telegram delivery failed on the server.")

    if not payload.get("success"):
        print(f"{RED}[-]{RESET} Instagram profile was not found or the upstream was unavailable.")


def main() -> None:
    while True:
        try:
            banner()
            print(f"{WHITE}[ 1 ]  Instagram Info{RESET}")
            print(f"{WHITE}[ 0 ]  Exit{RESET}\n")
            choice = input(f"{WHITE}[+]{RESET} Select Option : ").strip()

            if choice == "0":
                print(f"\n{WHITE}[+]{RESET} Exiting...")
                return
            if choice != "1":
                print(f"{RED}[-]{RESET} Invalid option")
                input("\nPress enter to continue")
                continue

            username = prompt_username()
            if username:
                show_search_result(username)
            input("\nPress enter to continue")
        except KeyboardInterrupt:
            print(f"\n{WHITE}[+]{RESET} Exiting...")
            return
        except EOFError:
            return


if __name__ == "__main__":
    main()
