#!/usr/bin/env python3
"""Explicit operator-only provisioning / synthetic checks on the existing brain.

Run on the existing server, not in a scheduler. Does not enable portal export,
alter existing clients, install services or perform a real guest-data import.
The credential is a runtime secret artifact, never a repository/config template.
"""
import argparse
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

SOURCE = 'airbnb-hoa-guests'
CLIENT = 'airbnb-hoa-guest-sync'
PREFIX = 'guest-cases/'
ORIGIN = 'http://127.0.0.1:3131'
MAX_BYTES = 2_000_000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def parse_client(raw):
    ids = re.findall(r'^\s*Client ID:\s+(gbrain_cl_[a-z0-9]+)\s*$', raw, re.M)
    secrets = re.findall(r'^\s*Client Secret:\s+(gbrain_cs_[a-z0-9]+)\s*$', raw, re.M)
    require(len(ids) == len(secrets) == 1, 'Invalid credential output')
    return ids[0], secrets[0]


def check_identity(identity, client_id):
    require(identity.get('transport') == 'oauth'
            and identity.get('client_id') == client_id
            and identity.get('source_id') == SOURCE
            and identity.get('federated_read') == [SOURCE]
            and set(identity.get('scopes', [])) == {'read', 'write'}
            and identity.get('expires_at') is not None, 'Unexpected grant')


def is_denied(result):
    text = json.dumps(result)
    return result.get('isError') is True and any(
        code in text for code in ('permission_denied', 'insufficient_scope', 'scope_denied'))


def check_token_grant(token):
    # OAuth can legally narrow a requested scope instead of rejecting it.
    # Validate the actual grant, not merely the token endpoint's status code.
    require(set(str(token.get('scope', '')).split()) == {'read', 'write'}
            and 0 < token.get('expires_in', 0) <= 300, 'Unexpected token grant')


def cli(*args):
    # Captured output may contain a newly minted secret. Never log/raise it.
    result = subprocess.run(['gbrain', *args], capture_output=True, text=True, timeout=45)
    require(result.returncode == 0, 'gbrain command failed; inspect state before retrying')
    return result.stdout


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Connection:
    def __init__(self, token=None):
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
        self.headers = {'Accept': 'application/json, text/event-stream'}
        if token:
            self.headers['Authorization'] = 'Bearer ' + token
        self.seq = 0

    def request(self, path, data=None, form=False):
        require(path in ('/health', '/token', '/mcp'), 'Unexpected endpoint')
        headers = dict(self.headers)
        if data is not None:
            headers['Content-Type'] = ('application/x-www-form-urlencoded' if form else 'application/json')
            body = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
        else:
            body = None
        request = urllib.request.Request(ORIGIN + path, data=body, headers=headers)
        with self.opener.open(request, timeout=45) as response:
            session = response.headers.get('Mcp-Session-Id')
            if session:
                self.headers['Mcp-Session-Id'] = session
            if response.status in (202, 204):
                return None
            if 'text/event-stream' in response.headers.get('Content-Type', ''):
                consumed, lines = 0, []
                while True:
                    raw = response.readline(MAX_BYTES - consumed + 1)
                    require(bool(raw), 'Incomplete response')
                    consumed += len(raw)
                    require(consumed <= MAX_BYTES, 'Oversized response')
                    line = raw.decode().rstrip('\r\n')
                    if line.startswith('data:'):
                        lines.append(line[5:].lstrip())
                    elif not line and lines:
                        result = json.loads('\n'.join(lines))
                        lines = []
                        if result.get('id') == data.get('id'):
                            return result
            raw = response.read(MAX_BYTES + 1)
            require(len(raw) <= MAX_BYTES, 'Oversized response')
            return json.loads(raw)

    def rpc(self, method, params):
        self.seq += 1
        result = self.request('/mcp', {'jsonrpc': '2.0', 'id': self.seq,
                                     'method': method, 'params': params})
        require(isinstance(result, dict) and result.get('id') == self.seq,
                'Mismatched response')
        require('result' in result, 'Protocol error; no retry performed')
        return result['result']

    def initialize(self):
        self.rpc('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                               'clientInfo': {'name': 'hoa-synthetic-scope-check', 'version': '1'}})
        self.request('/mcp', {'jsonrpc': '2.0', 'method': 'notifications/initialized'})

    def call(self, name, args):
        return self.rpc('tools/call', {'name': name, 'arguments': args})

    def value(self, name, args):
        result = self.call(name, args)
        require(not result.get('isError'), 'Operation rejected: ' + name)
        return json.loads('\n'.join(x['text'] for x in result.get('content', []) if x['type'] == 'text'))


def mint(client_id, secret, scopes='read write'):
    return Connection().request('/token', {'grant_type': 'client_credentials',
        'client_id': client_id, 'client_secret': secret, 'scope': scopes}, form=True)


def register(name, source, write=False):
    args = ['auth', 'register-client', name, '--source', source,
            '--federated-read', source, '--scopes', 'read write' if write else 'read',
            '--token-ttl', '300']
    if write:
        args += ['--bound-slug-prefixes', PREFIX, '--bound-tools', 'get_page,put_page,delete_page',
                 '--bound-source', SOURCE, '--budget-usd-per-day', '0']
    return parse_client(cli(*args))


def provision(path):
    require(not path.exists() and not path.is_symlink(), 'Credential already exists')
    clients = json.loads(cli('auth', 'clients', '--json'))['clients']
    require(not any(c['client_name'] == CLIENT for c in clients), 'Client already exists')
    # A pathless source never creates a guest-data Git repository or filesystem mirror.
    cli('sources', 'add', SOURCE, '--name', 'Private Airbnb HOA guest workflow', '--no-federated')
    path.parent.mkdir(mode=0o700, parents=False, exist_ok=True)
    require(not path.parent.is_symlink() and stat.S_IMODE(path.parent.stat().st_mode) == 0o700,
            'Credential directory must be private')
    # Reserve an exclusive, private journal BEFORE minting. Never overwrite credentials.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        client_id, secret = register(CLIENT, SOURCE, write=True)
        json.dump({'schema': 1, 'origin': ORIGIN, 'source_id': SOURCE,
                   'client_id': client_id, 'client_secret': secret}, handle)
        handle.flush()
        os.fsync(handle.fileno())
    print('Created pathless non-federated source and dedicated OAuth client.', flush=True)


def read_credentials(path):
    require(not path.is_symlink() and stat.S_IMODE(path.stat().st_mode) == 0o600,
            'Credential file must be private')
    credentials = json.loads(path.read_text())
    require(credentials.get('origin') == ORIGIN and credentials.get('source_id') == SOURCE,
            'Credential target mismatch')
    return credentials


def verify(credentials):
    client_id, secret = credentials['client_id'], credentials['client_secret']
    token = mint(client_id, secret)
    check_token_grant(token)
    conn = Connection(token['access_token'])
    conn.initialize()
    check_identity(conn.value('whoami', {}), client_id)
    print('PASS source-scoped OAuth identity and short-lived access token', flush=True)
    sources = conn.value('sources_list', {})['sources']
    require(len(sources) == 1 and sources[0]['id'] == SOURCE
            and sources[0]['federated'] is False and sources[0]['local_path'] is None,
            'Source isolation mismatch')
    print('PASS source enumeration restricted; no federation or filesystem mirror', flush=True)

    slug = PREFIX + 'scope-probe-' + uuid.uuid4().hex
    marker = 'hoascopetest' + uuid.uuid4().hex
    # Foreign operations target this unique nonexistent slug, never an actual foreign record.
    for name, args in [('get_page', {'slug': slug, 'source_id': 'default'}),
                       ('delete_page', {'slug': slug, 'source_id': 'default'}),
                       ('put_page', {'slug': 'outside-' + marker, 'content': '# Synthetic probe'}),
                       ('get_status_snapshot', {})]:
        require(is_denied(conn.call(name, args)), 'Expected permission denial: ' + name)
        print('PASS denied ' + name + (' outside grant' if name != 'get_status_snapshot' else ' admin'), flush=True)
    try:
        requested = mint(client_id, secret, 'read write admin')
    except urllib.error.HTTPError as exc:
        with exc:
            require(exc.code == 400, 'Unexpected elevation response')
            denial = json.loads(exc.read(MAX_BYTES))
            require(denial.get('error') in ('invalid_grant', 'invalid_scope'), 'Unexpected elevation error')
    else:
        check_token_grant(requested)
        narrowed = Connection(requested['access_token'])
        narrowed.initialize()
        check_identity(narrowed.value('whoami', {}), client_id)
        require(is_denied(narrowed.call('get_status_snapshot', {})), 'Elevated admin access')
    print('PASS elevated rights refused or request clamped to authorized grant', flush=True)

    # A temporary read-only client tests the opposite direction; revoke by exact ID.
    foreign_id, foreign_secret = register('hoa-scope-probe-' + uuid.uuid4().hex, 'default')
    wrote = False
    try:
        foreign = Connection(mint(foreign_id, foreign_secret, 'read')['access_token'])
        foreign.initialize()
        require(is_denied(foreign.call('get_page', {'slug': slug, 'source_id': SOURCE})),
                'Foreign client was not denied guest source')
        print('PASS default-only OAuth client denied guest-source read', flush=True)
        # Set before sending: on an uncertain response cleanup still targets only our probe.
        wrote = True
        conn.value('put_page', {'slug': slug, 'content':
            '---\ntitle: Synthetic HOA access test\ntype: concept\n---\n'
            '# Synthetic test only\n' + marker + '\nNo real guest data.\n'})
        page = conn.value('get_page', {'slug': slug})
        require(marker in json.dumps(page) and SOURCE in json.dumps(page), 'Written probe not readable')
        found = conn.value('search', {'query': marker, 'limit': 5})
        require(slug in json.dumps(found), 'Probe not searchable')
        print('PASS own-source write, read and search', flush=True)
    finally:
        # Only the synthetic page from this run and its temporary client are removed.
        try:
            if wrote:
                deleted = conn.value('delete_page', {'slug': slug, 'source_id': SOURCE})
                require(deleted.get('status') in ('soft_deleted', 'already_soft_deleted'), 'Delete unconfirmed')
                hidden = conn.call('get_page', {'slug': slug})
                require(hidden.get('isError') is True and 'page_not_found' in json.dumps(hidden),
                        'Deleted probe still visible')
                retained = conn.value('get_page', {'slug': slug, 'include_deleted': True})
                require(marker in json.dumps(retained), 'Soft-delete semantics unexpectedly changed')
                print('PASS probe hidden; recovery copy retained (not a hard purge)', flush=True)
        finally:
            cli('auth', 'revoke-client', foreign_id)
            print('Temporary verification client revoked.', flush=True)
    print('VERIFIED: no real guest data imported; live synchronization remains disabled.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', required=True, type=pathlib.Path)
    parser.add_argument('--provision', action='store_true', help='Explicitly create source and credential')
    args = parser.parse_args()
    try:
        health = Connection().request('/health')
        require(health.get('status') == 'ok', 'Existing service is not healthy')
        if args.provision:
            provision(args.credentials)
        verify(read_credentials(args.credentials))
    except Exception as exc:
        # No exception body, server response, credential or guest content in logs.
        print('STOP: ' + type(exc).__name__ + '; inspect state before retrying. No service restart.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
