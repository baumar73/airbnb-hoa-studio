#!/usr/bin/env python3
"""Codex stdio MCP -> existing gbrain HTTP MCP over authenticated SSH.

No local secret copy, remote installation, database access or service restart.
The remote token is read from the existing Hermes private configuration.
"""
import argparse
import os
import re
import shlex

REMOTE_CODE = r'''
import json, pathlib, re, sys, urllib.request, urllib.error
import yaml

MAX_RESPONSE_BYTES = 16_000_000

ALLOWED = {
    'search', 'get_page', 'list_pages', 'get_tags', 'get_links', 'get_backlinks',
    'get_timeline', 'get_brain_identity', 'whoami', 'sources_list', 'sources_status',
    'recall', 'context_pack', 'delta', 'entity', 'get_chunks', 'resolve_slugs',
    'get_versions', 'get_status_snapshot',
    'put_page', 'remember', 'add_tag', 'add_link', 'add_timeline_entry',
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def make_opener():
    # Even a configured environment proxy must never receive loopback auth/data.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)

def credentials():
    config = yaml.safe_load((pathlib.Path.home() / '.hermes' / 'config.yaml').read_text())
    server = config['mcp_servers']['gbrain']
    if server.get('enabled') is False or server['url'] != 'http://127.0.0.1:3131/mcp':
        raise ValueError('Unexpected endpoint')
    expected = 'HERMES_CONFIG_MCP_GBRAIN_AUTHORIZATION'
    values = {}
    for line in (pathlib.Path.home() / '.hermes' / '.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            if key.strip() == expected:
                values[expected] = value.strip().strip('\"\'')
    auth = server['headers']['Authorization']
    auth = re.sub(r'\$\{([A-Z_0-9]+)\}', lambda m: values[m[1]], auth)
    if not auth.startswith('Bearer ') or len(auth) < 39 or '\n' in auth or '\r' in auth:
        raise ValueError('Invalid authentication')
    return server['url'], {'Authorization': auth, 'Content-Type': 'application/json',
                           'Accept': 'application/json, text/event-stream'}

def emit(message):
    print(json.dumps(message, ensure_ascii=False), flush=True)

def failure(message, code, text):
    if 'id' in message:
        emit({'jsonrpc': '2.0', 'id': message['id'], 'error': {'code': code, 'message': text}})

def serve():
    endpoint, headers = credentials()
    opener = make_opener()
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                continue
        except ValueError:
            emit({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Invalid JSON'}})
            continue
        method = message.get('method', '')
        if not isinstance(method, str):
            failure(message, -32600, 'Method must be a string')
            continue
        params = message.get('params', {})
        if not isinstance(params, dict):
            failure(message, -32602, 'Parameters must be an object')
            continue
        if method == 'tools/call' and (not isinstance(params.get('name'), str) or params['name'] not in ALLOWED):
            failure(message, -32601, 'Tool is not enabled for this Codex connection')
            continue
        if method not in {'initialize', 'notifications/initialized', 'notifications/cancelled', 'ping', 'tools/list', 'tools/call'}:
            failure(message, -32601, 'Method is not supported by this connection')
            continue
        try:
            request = urllib.request.Request(endpoint, data=json.dumps(message).encode(), headers=headers)
            # No automatic request replay: an uncertain write must be inspected.
            with opener.open(request, timeout=55) as response:
                session = response.headers.get('Mcp-Session-Id')
                if session:
                    headers['Mcp-Session-Id'] = session
                if response.status in (202, 204):
                    continue
                if 'text/event-stream' in response.headers.get('Content-Type', ''):
                    result = None
                    data = []
                    consumed = 0
                    while True:
                        raw = response.readline(MAX_RESPONSE_BYTES - consumed + 1)
                        if not raw:
                            break
                        consumed += len(raw)
                        if consumed > MAX_RESPONSE_BYTES:
                            raise ValueError('Response too large')
                        item = raw.decode().rstrip('\r\n')
                        if item.startswith('data:'):
                            data.append(item[5:].lstrip())
                        elif not item and data:
                            candidate = json.loads('\n'.join(data)); data = []
                            if isinstance(candidate, dict) and 'id' in candidate and candidate['id'] == message.get('id'):
                                result = candidate
                                break
                else:
                    body = response.read(MAX_RESPONSE_BYTES + 1)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise ValueError('Response too large')
                    result = json.loads(body) if body.strip() else None
            if result is not None and 'id' in message:
                if not isinstance(result, dict) or result.get('id') != message['id']:
                    raise ValueError('Unexpected response id')
                if method == 'tools/list' and 'result' in result:
                    result['result']['tools'] = [t for t in result['result'].get('tools', []) if t['name'] in ALLOWED]
                emit(result)
            elif 'id' in message:
                failure(message, -32000, 'No MCP response received; do not blindly repeat writes')
        except Exception:
            # Never echo authentication, request bodies or server tracebacks.
            failure(message, -32000, 'gbrain connection failed; write outcome may be uncertain')

if __name__ == '__main__':
    try:
        serve()
    except Exception:
        print('gbrain connection could not start; check the existing private Hermes configuration.', file=sys.stderr)
        sys.exit(1)
'''

def ssh_argv(host):
    """Only a configured SSH alias, never shell text or SSH options."""
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', host):
        raise ValueError('Use a configured SSH host alias')
    command = 'python3 -u -c ' + shlex.quote(REMOTE_CODE)
    return ['/usr/bin/ssh', '-T', '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8',
        '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
        host, command]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ssh-host', required=True, help='Existing private SSH host alias')
    args = parser.parse_args()
    try:
        argv = ssh_argv(args.ssh_host)
    except ValueError as exc:
        parser.error(str(exc))
    os.execv(argv[0], argv)

if __name__ == '__main__':
    main()
