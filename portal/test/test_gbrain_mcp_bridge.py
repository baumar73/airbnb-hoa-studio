"""Offline bridge checks: synthetic credentials, no SSH/HTTP or brain writes."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / "scripts" / "gbrain_mcp_bridge.py"
spec = importlib.util.spec_from_file_location("gbrain_mcp_bridge", SCRIPT)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Response(io.BytesIO):
    status = 200

    def __init__(self, body, content_type="application/json", session=None):
        super().__init__(body)
        self.headers = {"Content-Type": content_type}
        if session:
            self.headers["Mcp-Session-Id"] = session


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.remote = {"__name__": "offline_test"}
        with patch.dict(sys.modules, {"yaml": types.SimpleNamespace()}):
            exec(compile(bridge.REMOTE_CODE, "remote", "exec"), self.remote)

    def run_messages(self, messages, responses):
        calls = []
        pending = iter(responses)

        class Opener:
            def open(self, request, timeout):
                calls.append(request)
                value = next(pending)
                if isinstance(value, Exception):
                    raise value
                return value

        output = io.StringIO()
        self.remote["credentials"] = lambda: ("http://127.0.0.1:3131/mcp", {})
        with patch("sys.stdin", io.StringIO("".join(json.dumps(m) + "\n" for m in messages))), patch("sys.stdout", output), patch("urllib.request.build_opener", return_value=Opener()):
            self.remote["serve"]()
        return [json.loads(line) for line in output.getvalue().splitlines()], calls

    def test_ssh_argv_quotes_remote_code_and_requires_known_host(self):
        argv = bridge.ssh_argv("example-hermes")
        self.assertIn("StrictHostKeyChecking=yes", argv)
        self.assertIn("BatchMode=yes", argv)
        self.assertEqual(argv[-2], "example-hermes")
        import shlex
        self.assertEqual(shlex.split(argv[-1]), ["python3", "-u", "-c", bridge.REMOTE_CODE])
        for value in ("-oProxyCommand=bad", "host;bad", "user@host", "host\n"):
            with self.assertRaises(ValueError):
                bridge.ssh_argv(value)

    def test_admin_and_unsupported_methods_never_leave_bridge(self):
        output, calls = self.run_messages([
            {"id": 1, "method": "tools/call", "params": {"name": "delete_page"}},
            {"id": 2, "method": "resources/read"},
        ], [])
        self.assertEqual(calls, [])
        self.assertEqual([m["error"]["code"] for m in output], [-32601, -32601])

    def test_invalid_params_do_not_crash_or_reach_server(self):
        messages = [{"id": i, "method": "tools/call", "params": p} for i, p in enumerate([None, [], "bad", {"name": []}])]
        output, calls = self.run_messages(messages, [])
        self.assertEqual(calls, [])
        self.assertEqual(len(output), 4)
        self.assertTrue(all("error" in m for m in output))

    def test_invalid_methods_do_not_break_following_valid_request(self):
        messages = [{"id": i, "method": value} for i, value in enumerate([[], {}, None])]
        messages.append({"id": 3, "method": "ping"})
        output, calls = self.run_messages(messages, [Response(b'{"id":3,"result":{}}')])
        self.assertEqual(len(calls), 1)
        self.assertTrue(all("error" in m for m in output[:3]))
        self.assertEqual(output[3], {"id": 3, "result": {}})

    def test_environment_proxy_cannot_receive_loopback_auth(self):
        import urllib.request
        with patch.dict("os.environ", {"http_proxy": "http://proxy.invalid:9999", "no_proxy": ""}, clear=True):
            opener = self.remote["make_opener"]()
        # An empty ProxyHandler has no protocol methods and may not be retained.
        self.assertFalse(any(isinstance(h, urllib.request.ProxyHandler) and h.proxies for h in opener.handlers))

    def test_tool_inventory_filtered(self):
        response = {"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "search"}, {"name": "put_page"}, {"name": "delete_page"}]}}
        output, calls = self.run_messages([{"id": 1, "method": "tools/list"}], [Response(json.dumps(response).encode())])
        self.assertEqual([t["name"] for t in output[0]["result"]["tools"]], ["search", "put_page"])
        self.assertEqual(len(calls), 1)

    def test_uncertain_write_is_not_retried_and_error_is_redacted(self):
        output, calls = self.run_messages([{"id": 1, "method": "tools/call", "params": {"name": "remember", "arguments": {"content": "synthetic"}}}], [RuntimeError("Bearer SECRET guest PRIVATE")])
        self.assertEqual(len(calls), 1)
        self.assertNotIn("SECRET", json.dumps(output))
        self.assertNotIn("PRIVATE", json.dumps(output))
        self.assertIn("uncertain", output[0]["error"]["message"])

    def test_sse_skips_notifications_and_matches_response_id(self):
        body = b'data: {"method":"note"}\n\ndata: {"id":1,\ndata: "result":{}}\n\n'
        output, _ = self.run_messages([{"id": 1, "method": "ping"}], [Response(body, "text/event-stream")])
        self.assertEqual(output, [{"id": 1, "result": {}}])

    def test_session_is_forwarded_on_next_request(self):
        messages = [{"id": 1, "method": "initialize"}, {"id": 2, "method": "ping"}]
        _, calls = self.run_messages(messages, [Response(b'{"id":1,"result":{}}', session="synthetic-session"), Response(b'{"id":2,"result":{}}')])
        self.assertEqual(calls[1].get_header("Mcp-session-id"), "synthetic-session")

    def test_response_size_is_bounded_for_json_and_sse(self):
        self.remote["MAX_RESPONSE_BYTES"] = 40
        for content_type, body in [("application/json", b" " * 41), ("text/event-stream", b"data: " + b"x" * 41)]:
            output, _ = self.run_messages([{"id": 1, "method": "ping"}], [Response(body, content_type)])
            self.assertIn("error", output[0])

    def test_mismatched_response_id_is_not_forwarded(self):
        output, _ = self.run_messages([{"id": 1, "method": "ping"}], [Response(b'{"id":999,"result":{}}')])
        self.assertEqual(output[0]["id"], 1)
        self.assertIn("error", output[0])

    def test_redirects_are_disabled(self):
        self.assertIsNone(self.remote["NoRedirect"]().redirect_request(None, None, None, None, None, None))

    def test_existing_private_config_auth_resolved_without_copy(self):
        auth = "Bearer " + "synthetic-test-value-" * 3
        config = {"mcp_servers": {"gbrain": {"url": "http://127.0.0.1:3131/mcp", "headers": {"Authorization": "${HERMES_CONFIG_MCP_GBRAIN_AUTHORIZATION}"}}}}
        self.remote["yaml"] = types.SimpleNamespace(safe_load=lambda text: config)
        with patch("pathlib.Path.read_text", side_effect=["unused", 'HERMES_CONFIG_MCP_GBRAIN_AUTHORIZATION="' + auth + '"\n']):
            endpoint, headers = self.remote["credentials"]()
        self.assertEqual(endpoint, "http://127.0.0.1:3131/mcp")
        self.assertEqual(headers["Authorization"], auth)
        config["mcp_servers"]["gbrain"]["url"] = "https://unapproved.invalid/mcp"
        with patch("pathlib.Path.read_text", return_value="unused"), self.assertRaises(ValueError):
            self.remote["credentials"]()


if __name__ == "__main__":
    unittest.main()
