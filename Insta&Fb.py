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
HEALTH_ENDPOINT = f"{API_BASE_URL}/api/health"
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

    output = payload.get("output")
    if isinstance(output, str) and output.strip():
        print(f"\n{output}")
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False))

    if payload.get("telegram_sent") is True:
        print(f"\n{GREEN}[+]{RESET} Result sent to Telegram by the API server.")
    elif payload.get("telegram_sent") is False:
        print(f"\n{RED}[-]{RESET} The API lookup completed, but Telegram delivery failed on the server.")

    if not payload.get("success"):
        print(f"{RED}[-]{RESET} Instagram profile was not found or the upstream was unavailable.")


def check_api() -> bool:
    try:
        response = SESSION.get(HEALTH_ENDPOINT, timeout=15)
        response.raise_for_status()
        payload = response.json()
        return payload.get("success") is True
    except (requests.RequestException, ValueError, AttributeError):
        return False


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
    if not check_api():
        print(f"{RED}[-]{RESET} API health check failed: {API_BASE_URL}")
        sys.exit(1)
    main()
