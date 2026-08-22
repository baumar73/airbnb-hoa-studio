#!/usr/bin/env python3
"""Read-only UniFi check for the Panama IP phone."""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import tomllib
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


PHONE_MAC = "44:db:d2:fc:6f:c5"
PHONE_NAME = "SIP-T73W"
PHONE_MODEL = "Yealink SIP-T73W"
DEFAULT_SITE = "default"
PANAMA_TZ = ZoneInfo("America/Panama")

SECRET_CANDIDATES = [
    Path.home() / ".codex/secrets/canon/network/services.toml",
    Path.home() / ".codex/secrets/network/services.toml",
]


def load_unifi_credentials() -> tuple[str, str, str]:
    for path in SECRET_CANDIDATES:
        if not path.exists():
            continue
        try:
            data = tomllib.loads(path.read_text())
        except tomllib.TOMLDecodeError:
            continue
        services = data.get("services") or {}
        for section_name in ("unifi_controller", "unifi"):
            section = services.get(section_name) or {}
            base_url = section.get("base_url")
            api_token = section.get("api_token")
            if base_url and api_token:
                return str(base_url).rstrip("/"), str(api_token), f"{path} [{section_name}]"
    raise RuntimeError("Kein UniFi-API-Token in den bekannten lokalen Secret-Dateien gefunden.")


def unifi_get(base_url: str, api_token: str, path: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{base_url}{path}",
        headers={"X-API-KEY": api_token, "Accept": "application/json"},
    )
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(request, context=context, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def payload_data(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    return data if isinstance(data, list) else []


def mac_matches(client: dict[str, Any]) -> bool:
    return str(client.get("mac") or client.get("macAddress") or "").lower() == PHONE_MAC


def panama_time(timestamp: Any) -> str:
    if not isinstance(timestamp, (int, float)) or not timestamp:
        return ""
    return datetime.fromtimestamp(timestamp, PANAMA_TZ).isoformat(timespec="seconds")


def compact_client(client: dict[str, Any] | None) -> dict[str, Any]:
    if not client:
        return {}
    return {
        "name": client.get("name") or client.get("hostname") or PHONE_NAME,
        "model": PHONE_MODEL,
        "mac": client.get("mac") or PHONE_MAC,
        "ip": client.get("ip") or client.get("last_ip") or client.get("fixed_ip") or "",
        "vendor": client.get("oui") or client.get("dev_vendor") or "Yealink",
        "wired": bool(client.get("is_wired")),
        "lastSeen": panama_time(client.get("last_seen")),
        "firstSeen": panama_time(client.get("first_seen")),
        "disconnectedAt": panama_time(client.get("disconnect_timestamp")),
        "network": client.get("network") or client.get("last_connection_network_name") or "",
        "uplinkName": client.get("last_uplink_name") or "",
        "uplinkMac": client.get("last_uplink_mac") or "",
        "uplinkPort": client.get("last_uplink_remote_port") or "",
    }


def port_status(devices: list[dict[str, Any]], uplink_mac: str, uplink_port: Any) -> dict[str, Any]:
    if not uplink_mac:
        return {}
    for device in devices:
        if str(device.get("mac") or "").lower() != str(uplink_mac).lower():
            continue
        result = {
            "switchName": device.get("name") or device.get("display_name") or "",
            "switchIp": device.get("ip") or "",
            "switchMac": device.get("mac") or "",
            "switchModel": device.get("model") or "",
            "switchState": device.get("state"),
            "port": uplink_port,
        }
        for port in device.get("port_table") or []:
            if str(port.get("port_idx")) != str(uplink_port):
                continue
            result.update(
                {
                    "portName": port.get("name") or f"Port {uplink_port}",
                    "linkUp": bool(port.get("up")),
                    "enabled": bool(port.get("enable")),
                    "speed": port.get("speed") or 0,
                    "poeEnabled": bool(port.get("poe_enable")),
                    "poeMode": port.get("poe_mode") or "",
                    "poePower": port.get("poe_power") or "0.00",
                }
            )
            break
        return result
    return {}


def build_report() -> dict[str, Any]:
    base_url, api_token, secret_source = load_unifi_credentials()
    active_clients = payload_data(unifi_get(base_url, api_token, f"/proxy/network/api/s/{DEFAULT_SITE}/stat/sta"))
    known_clients = payload_data(unifi_get(base_url, api_token, f"/proxy/network/api/s/{DEFAULT_SITE}/stat/alluser"))
    rest_clients = payload_data(unifi_get(base_url, api_token, f"/proxy/network/api/s/{DEFAULT_SITE}/rest/user"))
    devices = payload_data(unifi_get(base_url, api_token, f"/proxy/network/api/s/{DEFAULT_SITE}/stat/device"))

    active_match = next((client for client in active_clients if mac_matches(client)), None)
    historical_match = next((client for client in [*known_clients, *rest_clients] if mac_matches(client)), None)
    client = compact_client(active_match or historical_match)
    switch_port = port_status(devices, str(client.get("uplinkMac") or ""), client.get("uplinkPort"))
    online = active_match is not None

    if online:
        status = "online"
        action = "Telefon ist im UniFi-Netz sichtbar. Als naechstes SIP-/Provider-Konfiguration pruefen."
    elif switch_port and switch_port.get("linkUp") is False:
        status = "offline_port_down"
        action = "Telefon physisch suchen/einstecken: zuletzt USW Flex BedR 1 Port 5; Port ist aktuell down."
    else:
        status = "offline_unknown"
        action = "Telefon ist nicht aktiv sichtbar. Strom, LAN-Kabel, Switch-Port und Netzteil pruefen."

    return {
        "generatedAt": datetime.now(PANAMA_TZ).isoformat(timespec="seconds"),
        "project": "panama_house",
        "purpose": "Panama Heimnetz-Telefonie / Auslandsanrufe",
        "status": status,
        "online": online,
        "phone": client
        or {
            "name": PHONE_NAME,
            "model": PHONE_MODEL,
            "mac": PHONE_MAC,
        },
        "switchPort": switch_port,
        "action": action,
        "source": {
            "unifiBaseUrl": base_url,
            "secretSource": secret_source,
            "mode": "read_only",
        },
    }


def print_text(report: dict[str, Any]) -> None:
    phone = report.get("phone") or {}
    switch = report.get("switchPort") or {}
    print(f"Panama IP-Telefon Status ({report.get('generatedAt')})")
    print(f"Status: {report.get('status')}")
    print(f"Geraet: {phone.get('model')} / {phone.get('name')}")
    print(f"MAC: {phone.get('mac')}")
    if phone.get("ip"):
        print(f"IP: {phone.get('ip')}")
    if phone.get("lastSeen"):
        print(f"Zuletzt gesehen: {phone.get('lastSeen')}")
    if phone.get("disconnectedAt"):
        print(f"Getrennt: {phone.get('disconnectedAt')}")
    if switch:
        print(
            "Letzter/zugeordneter Anschluss: "
            f"{switch.get('switchName') or '-'} {switch.get('portName') or switch.get('port') or '-'} "
            f"(Link {'up' if switch.get('linkUp') else 'down'}, PoE {switch.get('poePower') or '0.00'} W)"
        )
    print(f"Naechste Aktion: {report.get('action')}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only UniFi check for the Panama Yealink IP phone")
    parser.add_argument("--json", action="store_true", help="JSON statt Text ausgeben")
    args = parser.parse_args()
    try:
        report = build_report()
    except (RuntimeError, urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        if args.json:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        else:
            print(f"Panama IP-Telefon konnte nicht geprueft werden: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps({"ok": True, "report": report}, ensure_ascii=False, indent=2))
    else:
        print_text(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
